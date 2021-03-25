import * as chokidar from 'chokidar'
import * as fs from 'fs'
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

    constructor(context: vscode.ExtensionContext) {
        this.globalState = context.globalState
        this.fswatcher.on('change', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const uri = this.toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Changed, uri }])
            })
        })
        this.fswatcher.on('add', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const uri = this.toLocalFsUri(filePath)
                console.log(uri.toString(true))
                cb([{ type: vscode.FileChangeType.Created, uri }])
            })
        })
        this.fswatcher.on('unlink', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const uri = this.toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Deleted, uri }])
            })
        })
    }

    toFilePath(uri: vscode.Uri) {
        if (uri.scheme === 'file') {
            console.log(`${uri.toString(true)}`)
            return uri.fsPath
        } else if (uri.scheme === 'localfs') {
            const rootDirUriString = this.globalState.get('dummyhost') as string
            if (!rootDirUriString) {
                throw new Error(uri.toString(true))
            }
            const rootDir = vscode.Uri.parse(rootDirUriString)
            const fileUri = vscode.Uri.joinPath(rootDir, uri.path)
            return fileUri.fsPath
        } else {
            throw new Error(uri.toString(true))
        }
    }

    toLocalFsUri(filePath: string) {
        const rootDirUriString = this.globalState.get('dummyhost') as string
        if (!rootDirUriString) {
            throw new Error(filePath)
        }
        const rootDir = vscode.Uri.parse(rootDirUriString)
        const uriPath = filePath.replace(rootDir.fsPath, '')
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
        console.log(uri.toString(true))
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

    createDirectory(uri: vscode.Uri) {
        const dirPath = this.toFilePath(uri)
        return fs.promises.mkdir(dirPath, {recursive: true})
    }

    async copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.assertExists(source)
        const sourcePath = this.toFilePath(source)
        const targetPath = this.toFilePath(target)
        const buf = await fs.promises.readFile(sourcePath)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.writeFile(targetPath, buf)
        }
    }

    delete(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = this.toFilePath(uri)
        return fs.promises.unlink(filePath)
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        this.assertExists(uri)
        const dirPath = this.toFilePath(uri)
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
        const cb: (e: fs.Dirent) => [string, vscode.FileType] = ent => [ent.name, this.getFileType(ent)]
        const result = entries.map(cb)
        return result
    }

    async readFile(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = this.toFilePath(uri)
        const buf = await fs.promises.readFile(filePath)
        return new Uint8Array(buf)
    }

    rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.assertExists(source)
        const sourcePath = this.toFilePath(source)
        const targetPath = this.toFilePath(target)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.rename(sourcePath, targetPath)
        }
        return
    }

    async stat(uri: vscode.Uri) {
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

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }) {
        const filePath = this.toFilePath(uri)
        if (fs.existsSync(filePath)) {
            if (options.overwrite) {
                fs.promises.writeFile(filePath, content)
            }
        } else {
            if (options.create) {
                fs.promises.writeFile(filePath, content)
            }
        }
    }

    watch(uri: vscode.Uri) {
        const filePath = this.toFilePath(uri)
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

