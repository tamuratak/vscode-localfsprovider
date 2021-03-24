import * as chokidar from 'chokidar'
import * as fs from 'fs'
import * as vscode from 'vscode'


export function activate(context: vscode.ExtensionContext) {
    const localfs = new LocalFs()
    if (!localfs) {
        return
    }
    console.log('LocalFS says "Hello"')
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('localfs', localfs, { isCaseSensitive: true }))
    context.subscriptions.push(vscode.commands.registerCommand('localfs.workspaceInit', _ => {
        openLocalFsWorkspace()
    }))
}

async function openLocalFsWorkspace(): Promise<boolean | undefined> {
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false })
    const uri = uris?.[0]
    if (!uri) {
        return
    }
    const localfsUri = toLocalFsUri(uri.fsPath)
    console.log(localfsUri.toString(true))
    return vscode.workspace.updateWorkspaceFolders(0, 0, { uri: localfsUri, name: 'localfs - Sample' })
}

function toFilePath(uri: vscode.Uri) {
    if (uri.scheme === 'file') {
        console.log(`${uri.toString(true)}`)
        return uri.fsPath
    } else if (uri.scheme === 'localfs') {
        return uri.fsPath.replace(/^\/virtual_local_fs/, '')
    } else {
        throw new Error(uri.toString(true))
    }
}

function toLocalFsUri(filePath: string) {
    const uri = vscode.Uri.file(filePath)
    return uri.with({ scheme: 'localfs', path: '/virtual_local_fs' + uri.path })
}

interface FileTypeBase {
    isFile(): boolean,
    isDirectory(): boolean,
    isSymbolicLink(): boolean
}

export class LocalFs implements vscode.FileSystemProvider {
    private readonly onDidChangeFileEventCbSet: Set<(events: vscode.FileChangeEvent[]) => void> = new Set()
    private readonly fswatcher = chokidar.watch([], {usePolling: true})

    constructor() {
        this.fswatcher.on('change', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const uri = toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Changed, uri }])
            })
        })
        this.fswatcher.on('add', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const uri = toLocalFsUri(filePath)
                console.log(uri.toString(true))
                cb([{ type: vscode.FileChangeType.Created, uri }])
            })
        })
        this.fswatcher.on('unlink', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const uri = toLocalFsUri(filePath)
                cb([{ type: vscode.FileChangeType.Deleted, uri }])
            })
        })
    }


    assertExists(...uris: vscode.Uri[]) {
        uris.forEach(uri => {
            const filePath = toFilePath(uri)
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
        const dirPath = toFilePath(uri)
        return fs.promises.mkdir(dirPath, {recursive: true})
    }

    async copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.assertExists(source)
        const sourcePath = toFilePath(source)
        const targetPath = toFilePath(target)
        const buf = await fs.promises.readFile(sourcePath)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.writeFile(targetPath, buf)
        }
    }

    delete(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = toFilePath(uri)
        return fs.promises.unlink(filePath)
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        this.assertExists(uri)
        const dirPath = toFilePath(uri)
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
        const cb: (e: fs.Dirent) => [string, vscode.FileType] = ent => [ent.name, this.getFileType(ent)]
        const result = entries.map(cb)
        return result
    }

    async readFile(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = toFilePath(uri)
        const buf = await fs.promises.readFile(filePath)
        return new Uint8Array(buf)
    }

    rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.assertExists(source)
        const sourcePath = toFilePath(source)
        const targetPath = toFilePath(target)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.rename(sourcePath, targetPath)
        }
        return
    }

    async stat(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = toFilePath(uri)
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
        const filePath = toFilePath(uri)
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
        const filePath = toFilePath(uri)
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

