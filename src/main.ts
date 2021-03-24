import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'


export function activate(context: vscode.ExtensionContext) {

    console.log('LocalFS says "Hello"')

    const localfs = new LocalFs()
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('localfs', localfs, { isCaseSensitive: true }))


    context.subscriptions.push(vscode.commands.registerCommand('localfs.workspaceInit', _ => {
        vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse('localfs:/'), name: 'localfs - Sample' })
    }))
}

interface FileTypeBase {
    isFile(): boolean,
    isDirectory(): boolean,
    isSymbolicLink(): boolean
}


export class LocalFs implements vscode.FileSystemProvider {
    private readonly onDidChangeFileEventCbSet: Set<(events: vscode.FileChangeEvent[]) => void> = new Set()
    private readonly localDirPath: string

    constructor(localDirPath: string) {
        this.localDirPath = localDirPath
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
        const dirPath = path.join(this.localDirPath, uri.fsPath)
        return fs.promises.mkdir(dirPath, {recursive: true})
    }

    async copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        const sourcePath = path.join(this.localDirPath, source.fsPath)
        const targetPath = path.join(this.localDirPath, target.fsPath)
        const buf = await fs.promises.readFile(sourcePath)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.writeFile(targetPath, buf)
        }
    }

    delete(uri: vscode.Uri) {
        const filePath = path.join(this.localDirPath, uri.fsPath)
        return fs.promises.unlink(filePath)
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const dirPath = path.join(this.localDirPath, uri.fsPath)
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
        const cb: (e: fs.Dirent) => [string, vscode.FileType] = ent => [ent.name, this.getFileType(ent)]
        const result = entries.map(cb)
        return result
    }

    async readFile(uri: vscode.Uri) {
        const filePath = path.join(this.localDirPath, uri.fsPath)
        const buf = await fs.promises.readFile(filePath)
        return new Uint8Array(buf)
    }

    rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) {
        const sourcePath = path.join(this.localDirPath, source.fsPath)
        const targetPath = path.join(this.localDirPath, target.fsPath)
        if (!fs.existsSync(targetPath) || options?.overwrite) {
            return fs.promises.rename(sourcePath, targetPath)
        }
        return
    }

    async stat(uri: vscode.Uri) {
        const filePath = path.join(this.localDirPath, uri.fsPath)
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
        const filePath = path.join(this.localDirPath, uri.fsPath)
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

    watch(uri: vscode.Uri, options: { recursive: boolean, excludes: string[] }) {
        const filePath = path.join(this.localDirPath, uri.fsPath)
        const watcher = fs.watch(filePath, { recursive: options.recursive }, () => {
            this.onDidChangeFileEventCbSet.forEach(cb => {
                cb([{type: vscode.FileChangeType.Changed, uri}])
            })
        })
        const diposable = new vscode.Disposable(() => watcher.close())
        return diposable
    }

    onDidChangeFile(cb: (events: vscode.FileChangeEvent[]) => void) {
        this.onDidChangeFileEventCbSet.add(cb)
        const diposable = new vscode.Disposable(() => this.onDidChangeFileEventCbSet.delete(cb))
        return diposable
    }

}

