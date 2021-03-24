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

export class LocalFs implements vscode.FileSystemProvider {
    private readonly localDirPath: string

    constructor(localDirPath: string) {
        this.localDirPath = localDirPath
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

    }
}

