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
    const localfsUri = uri.with({scheme: 'localfs'})
    console.log(localfsUri.toString(true))
    return vscode.workspace.updateWorkspaceFolders(0, 0, { uri: localfsUri, name: 'localfs - Sample' })
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
                const fileUri = vscode.Uri.file(filePath)
                cb([{ type: vscode.FileChangeType.Changed, uri: fileUri.with({scheme: 'localfs'}) }])
            })
        })
        this.fswatcher.on('add', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const fileUri = vscode.Uri.file(filePath)
                cb([{ type: vscode.FileChangeType.Created, uri: fileUri.with({scheme: 'localfs'}) }])
            })
        })
        this.fswatcher.on('unlink', (filePath: string) => {
            this.onDidChangeFileEventCbSet.forEach( cb => {
                const fileUri = vscode.Uri.file(filePath)
                cb([{ type: vscode.FileChangeType.Deleted, uri: fileUri.with({scheme: 'localfs'}) }])
            })
        })
    }

    assertExists(...uris: vscode.Uri[]) {
        uris.forEach(uri => {
            if (!fs.existsSync(uri.fsPath)) {
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
        const dirPath = uri.fsPath
        return fs.promises.mkdir(dirPath, {recursive: true})
    }

    async copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.assertExists(source)
        const sourcePath = source.fsPath
        const targetPath = target.fsPath
        const buf = await fs.promises.readFile(sourcePath)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.writeFile(targetPath, buf)
        }
    }

    delete(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = uri.fsPath
        return fs.promises.unlink(filePath)
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        this.assertExists(uri)
        const dirPath = uri.fsPath
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
        const cb: (e: fs.Dirent) => [string, vscode.FileType] = ent => [ent.name, this.getFileType(ent)]
        const result = entries.map(cb)
        return result
    }

    async readFile(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = uri.fsPath
        console.log(`readFile: ${filePath}`)
        const buf = await fs.promises.readFile(filePath)
        return new Uint8Array(buf)
    }

    rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        this.assertExists(source)
        console.log(`rename called:${source.toString(true)}`)
        const sourcePath = source.fsPath
        const targetPath = target.fsPath
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.rename(sourcePath, targetPath)
        }
        return
    }

    async stat(uri: vscode.Uri) {
        this.assertExists(uri)
        const filePath = uri.fsPath
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
        const filePath = uri.fsPath
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
        const filePath = uri.fsPath
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

