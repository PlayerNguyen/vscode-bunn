import { existsSync, readFileSync, writeFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import * as https from "https";
import { window, workspace } from "vscode";
import * as vscode from "vscode";
import path = require("path");
import { IncomingMessage } from "http";
import { homedir } from "os";

/**
 * Check whether or not the bun is existing on the platform by
 * executing a new terminal process `bun` (shell check) and
 * determine the process.env.BUN_INSTALL directory.
 *
 * @returns true if the bun is existing, false otherwise
 *
 */
export function hasBun(): boolean {
  if (process.env.BUN_INSTALL && existsSync(process.env.BUN_INSTALL)) {
    return true;
  }

  let bunProcess = spawnSync("bun");
  return bunProcess.output !== null && bunProcess.output.length !== 0;
}

/**
 * Install a bun by
 * running a script `curl -fsSL https://bun.sh/install | bash`
 * inside a Integrated Terminal. Then show the version information
 * after finished installed
 * @deprecated using
 */
export function installBun(): void {
  // execute curl -fsSL https://bun.sh/install | bash
  const terminal = window.createTerminal("Install bun");
  terminal.sendText("curl -fsSL https://bun.sh/install | bash");
  terminal.sendText("exit");
  terminal.show();

  window.onDidCloseTerminal((_terminal) => {
    // Successfully install bun
    if (terminal === _terminal && _terminal.exitStatus?.code === 0) {
      const version = getBunVersion();
      window.showInformationMessage(
        `Successfully install bun with version ${version}`
      );
    }
  });
}

export async function installBunAsProcess() {
  const fileDestinationUri = vscode.Uri.file(
    path.join(homedir(), "install.sh")
  );
  console.log(`Trying to write a file into ${fileDestinationUri.path}`);

  // Start downloading the install script
  await downloadInstallScript(fileDestinationUri);

  // Create a status bar for progress
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right
  );
  statusBar.show();

  // Then start downloading bun
  await spawnInstallProcess(fileDestinationUri, {
    onDidProgress: (percentage: string) => {
      statusBar.text = `Installing Bun: ${percentage}`;
      statusBar.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    },
  });
  statusBar.dispose();

  console.log(`Cleaning up the install.sh`);
  cleanInstallScript(fileDestinationUri);

  // Display a message info
  let bunVersion = getBunVersion();
  window.showInformationMessage(`Successfully install Bun (v${bunVersion})`);
}

/**
 * Getting bun version from command `bun version`.
 * @returns a bun version as semver format
 * @throws when bun is not installed
 */
export function getBunVersion() {
  let bunProcess = spawnSync("bun", ["--version"]);
  if (bunProcess.output === undefined) {
    throw new Error("Bun is not installed");
  }
  return bunProcess.output[1]?.toString();
}

export function downloadInstallScript(destination: vscode.Uri): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get("https://bun.sh/install", (res: IncomingMessage) => {
      // If the status code is not 200
      const { statusCode } = res;
      if (statusCode !== 200) {
        return reject(new Error("Failed to make http request"));
      }

      let downloadContent = "";
      res.on("data", (chunk) => {
        downloadContent += chunk;
      });

      res.on("close", async () => {
        // Save the file
        await workspace.fs.writeFile(
          destination,
          Buffer.from(downloadContent, "utf-8")
        );
        // Then resolve the async function
        resolve();
      });
    });
  });
}

/**
 * Spawn a progress to execute install.sh script
 *
 * @param installFileDestination a script destination
 *  which was downloaded
 * @param options an options using for
 * @returns a promise resolved when successfully downloaded
 */
export function spawnInstallProcess(
  installFileDestination: vscode.Uri,
  options?: { onDidProgress: (percentage: string) => void }
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Then running batch with file
    let process = spawn("bash", [installFileDestination.path], {});

    // Extract the download progress
    process.stderr.on("data", (chunk) => {
      let separated: string[] = chunk.toString().trim().split(" ");
      let percentageArr = separated.filter((x) =>
        new RegExp(/([1-9])\w*/g).test(x)
      );

      if (percentageArr.length > 0) {
        let percentage = percentageArr[0];

        console.log(`Bun installer progress: ${percentage}`);

        // Call the event
        if (options && options.onDidProgress !== undefined) {
          options.onDidProgress(percentage);
        }
      }
    });
    // If the process is exiting
    process.on("exit", (exitCode: number) => {
      console.log(`Bun installer exit: ${exitCode?.toString()}`);

      // Reject the exit code
      if (exitCode !== 0) {
        return reject(new Error("Something failed with installer"));
      }

      // Resolve the process
      resolve();
    });
  });
}

export function cleanInstallScript(installFileDestination: vscode.Uri) {
  workspace.fs.delete(installFileDestination);
}