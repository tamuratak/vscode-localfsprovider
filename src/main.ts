import * as chokidar from 'chokidar'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'


export function activate(context: vscode.ExtensionContext) {
    const localfs = new LocalFs(context)
    if (!localfs) {
        return
    }
    console.log('LocalFS says "Hello"')
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('localfs', localfs, { isCaseSensitive: true }))
    context.subscriptions.push(vscode.commands.registerCommand('localfs.workspaceInit', _ => {
        localfs.openLocalFsWorkspace()
    }))
}

interface FileTypeBase {
    isFile(): boolean,
    isDirectory(): boolean,
    isSymbolicLink(): boolean
}

export class LocalFs implements vscode.FileSystemProvider {
    private readonly onDidChangeFileEventCbSet: Set<(events: vscode.FileChangeEvent[]) => void> = new Set()
    private readonly fswatcher = chokidar.watch([], {usePolling: true})
    private readonly globalState: vscode.Memento
    private readonly logPanel: vscode.OutputChannel = vscode.window.createOutputChannel('LocalFs')

    constructor(context: vscode.ExtensionContext) {
        this.globalState = context.globalState
        this.fswatcher.on('change', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                this.addLogMessage(`change detected: ${filePath}`)
                const uri = this.toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Changed, uri }])
            })
        })
        this.fswatcher.on('add', (filePath: string) => {
            if (this.isIgnoredFilePath(filePath)) {
                this.addLogMessage(`change add ignored: ${filePath}`)
                return
            }
            this.onDidChangeFileEventCbSet.forEach( cb => {
                this.addLogMessage(`add detected: ${filePath}`)
                const uri = this.toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Created, uri }])
            })
        })
        this.fswatcher.on('unlink', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                this.addLogMessage(`unlink detected: ${filePath}`)
                const uri = this.toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Deleted, uri }])
            })
        })
    }

    getRootDir() {
        const rootDirUriString = this.globalState.get('dummyhost') as string
        if (!rootDirUriString) {
            throw new vscode.FileSystemError('rootDir not found.')
        }
        const rootDir = vscode.Uri.parse(rootDirUriString)
        return rootDir
    }

    addLogMessage(message: string) {
        this.logPanel.append(`[${new Date().toLocaleTimeString(undefined, { hour12: false })}] ${message}\n`)
    }

    isIgnoredFilePath(filePath: string): boolean {
        return /\b\.git\b|\bnode_modules\b/.exec(filePath) ? true : false
    }

    toFilePath(uri: vscode.Uri) {
        if (uri.scheme === 'file') {
            return uri.fsPath
        } else if (uri.scheme === 'localfs') {
            const rootDir = this.getRootDir()
            const fileUri = vscode.Uri.joinPath(rootDir, uri.path)
            return fileUri.fsPath
        } else {
            throw new vscode.FileSystemError(`Unknown scheme: ${uri.toString(true)}`)
        }
    }

    toLocalFsUri(filePath: string) {
        const rootDir = this.getRootDir()
        let uriPath = filePath
        if (uriPath.startsWith(rootDir.fsPath)) {
            uriPath = uriPath.slice(rootDir.fsPath.length)
        } else {
            throw new vscode.FileSystemError(`Invalid file path: ${filePath}`)
        }
        const uri = vscode.Uri.joinPath(vscode.Uri.parse('localfs://dummyhost/'), uriPath)
        return uri
    }

    async openLocalFsWorkspace(): Promise<boolean | undefined> {
        const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false })
        const uri = uris?.[0]
        if (!uri) {
            return
        }
        this.globalState.update('dummyhost', uri.toString(true))
        const workspaceUri = vscode.Uri.parse('localfs://dummyhost/')
        return vscode.workspace.updateWorkspaceFolders(0, 0, { uri: workspaceUri, name: 'localfs - Sample' })
    }

    assertExists(...uris: vscode.Uri[]) {
        uris.forEach(uri => {
            const filePath = this.toFilePath(uri)
            if (!fs.existsSync(filePath)) {
                throw vscode.FileSystemError.FileNotFound(uri)
            }
        })
    }

    assertParentDirExists(filePath: string) {
        const dirname = path.dirname(filePath)
        if (!fs.existsSync(dirname)) {
            const msg = `The parent dir does not exist: ${dirname} for ${filePath}`
            this.addLogMessage(msg)
            throw vscode.FileSystemError.FileNotFound(msg)
        }
    }

    catchPermissionError(cb: () => Promise<void>, filePath: string) {
        try {
            return cb()
        } catch (err: any) {
            if (err.code === 'EACCES') {
                const msg = `writeFile failes. EACCES: ${filePath}`
                this.addLogMessage(msg)
                throw vscode.FileSystemError.NoPermissions(msg)
            } else {
                const msg = `writeFile unknown error ${err.message}: ${filePath}`
                this.addLogMessage(msg)
                throw new vscode.FileSystemError(msg)
            }
        }
    }

    private getFileType(ent: FileTypeBase): vscode.FileType {
        if (ent.isSymbolicLink()) {
            return vscode.FileType.SymbolicLink
        } else if (ent.isDirectory()) {
            return vscode.FileType.Directory
        } else if (ent.isFile()) {
            return vscode.FileType.File
        } else {
            return vscode.FileType.Unknown
        }
    }

    async createDirectory(uri: vscode.Uri) {
        this.addLogMessage(`createDirectory called: ${uri.toString(true)}`)
        const dirPath = this.toFilePath(uri)
        this.assertParentDirExists(dirPath)
        if (fs.existsSync(dirPath)) {
            throw vscode.FileSystemError.FileExists(dirPath)
        }
        return this.catchPermissionError(
            () => fs.promises.mkdir(dirPath),
            dirPath
        )
    }


    async copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.addLogMessage(`copy called: source: ${source.toString(true)} target: ${target.toString(true)}`)
        this.assertExists(source)
        const sourcePath = this.toFilePath(source)
        const targetPath = this.toFilePath(target)
        this.assertParentDirExists(targetPath)
        const buf = await fs.promises.readFile(sourcePath)
        if (fs.existsSync(targetPath) && !options?.overwrite) {
            const msg = `copy failed. The target file exists: ${targetPath}`
            this.addLogMessage(msg)
            throw vscode.FileSystemError.FileExists(msg)
        }
        return this.catchPermissionError(
            () => fs.promises.writeFile(targetPath, buf),
            targetPath
        )
    }

    async delete(uri: vscode.Uri) {
        this.addLogMessage(`delete called: ${uri.toString(true)}`)
        this.assertExists(uri)
        const filePath = this.toFilePath(uri)
        return this.catchPermissionError(
            () => fs.promises.unlink(filePath),
            filePath
        )
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        this.addLogMessage(`readDirectory called: ${uri.toString(true)}`)
        this.assertExists(uri)
        const dirPath = this.toFilePath(uri)
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
        const cb: (e: fs.Dirent) => [string, vscode.FileType] = ent => [ent.name, this.getFileType(ent)]
        const result = entries.map(cb)
        return result
    }

    async readFile(uri: vscode.Uri) {
        this.addLogMessage(`readFile called: ${uri.toString(true)}`)
        this.assertExists(uri)
        const filePath = this.toFilePath(uri)
        const buf = await fs.promises.readFile(filePath)
        return new Uint8Array(buf)
    }

    async rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.addLogMessage(`rename called: source: ${source.toString(true)} target: ${target.toString(true)}`)
        this.assertExists(source)
        const sourcePath = this.toFilePath(source)
        const targetPath = this.toFilePath(target)
        this.assertParentDirExists(targetPath)
        if (fs.existsSync(targetPath) && !options?.overwrite) {
            const msg = `rename failed. A target file exists: ${target.toString(true)}`
            this.addLogMessage(msg)
            throw vscode.FileSystemError.FileExists(msg)
        }
        return this.catchPermissionError(
            () => fs.promises.rename(sourcePath, targetPath),
            targetPath
        )
    }

    async stat(uri: vscode.Uri) {
        this.addLogMessage(`stat called: ${uri.toString(true)}`)
        this.assertExists(uri)
        const filePath = this.toFilePath(uri)
        const statret = await fs.promises.stat(filePath)
        const ret: vscode.FileStat = {
            ctime: statret.ctimeMs,
            mtime: statret.mtimeMs,
            size: statret.size,
            type: this.getFileType(statret)
        }
        return ret
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }) {
        this.addLogMessage(`writeFile called: ${uri.toString(true)}`)
        const filePath = this.toFilePath(uri)
        if (fs.existsSync(filePath)) {
            if (options.overwrite) {
                return this.catchPermissionError(
                    () => fs.promises.writeFile(filePath, content),
                    filePath
                )
            } else {
                const msg = `writeFile failes. The file exists: ${uri.toString(true)}`
                this.addLogMessage(msg)
                throw vscode.FileSystemError.FileExists(msg)
            }
        } else {
            if (options.create) {
                const dirname = path.dirname(filePath)
                if (!fs.existsSync(dirname)) {
                    const msg = `writeFile failes. The dir does not exist: ${uri.toString(true)}`
                    this.addLogMessage(msg)
                    throw vscode.FileSystemError.FileNotFound(msg)
                }
                return this.catchPermissionError(
                    () => fs.promises.writeFile(filePath, content),
                    filePath
                )
            } else {
                const msg = `writeFile failes. The file does not exist: ${uri.toString(true)}`
                this.addLogMessage(msg)
                throw vscode.FileSystemError.FileNotFound(msg)
            }
        }
    }

    watch(uri: vscode.Uri, options: { recursive: boolean, excludes: string[] }) {
        this.addLogMessage(`watch called: ${uri.toString(true)}`)
        if (options) {
            this.addLogMessage('localfs watch: options ignored.')
        }
        const filePath = this.toFilePath(uri)
        if (this.isIgnoredFilePath(filePath)) {
            this.addLogMessage(`watch ignored: ${filePath}`)
            return new vscode.Disposable( () => {} )
        }
        this.fswatcher.add(filePath)
        const diposable = new vscode.Disposable( () => this.fswatcher.unwatch(filePath) )
        return diposable
    }

    onDidChangeFile(cb: (events: vscode.FileChangeEvent[]) => void) {
        this.onDidChangeFileEventCbSet.add(cb)
        const diposable = new vscode.Disposable(() => this.onDidChangeFileEventCbSet.delete(cb))
        return diposable
    }

}

