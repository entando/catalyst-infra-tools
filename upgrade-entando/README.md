
# Upgrade Entando CLI v1.0.0

The Upgrade Entando CLI is a command-line tool for simplifying the upgrade of Entando. This tool streamlines the process and provides a guided experience to upgrade your version of Entando.

## Installation

The Upgrade Entando CLI is not available on npm. Instead, you can download the binary distribution for your OS and architecture from the [releases](https://github.com/entando/catalyst-infra-tools/releases?q=upgrade-entando&expanded=true) page. The binary files are named in the following format:

- Linux: `upgrade-entando-v1.0.0-linux-arm64` | `upgrade-entando-v1.0.0-linux-x64`

- macOS: `upgrade-entando-v1.0.0-macos-arm64` | `upgrade-entando-v1.0.0-macos-x64`

- Windows: `upgrade-entando-v1.0.0-windows-arm64.exe` | `upgrade-entando-v1.0.0-windows-x64.exe`

Once you've downloaded the appropriate binary for your system, you can run it from the command line.

## Usage

To use the Upgrade Entando CLI, follow these steps:

1. Download the binary for your OS and architecture as mentioned in the installation section.

2. Open a terminal and navigate to the directory where you downloaded the binary.

3. Make sure that the binary is executable (Linux and MacOS) and then run the CLI.

```bash

$ chmod +x upgrade-entando-v1.0.0-linux-x64

$ ./upgrade-entando-v1.0.0-linux-x64

```

Replace `./upgrade-entando-v1.0.0-linux-x64` with the actual name of the binary you downloaded.

4. The CLI will guide you through the upgrade process.

## Command Flags

Here are the available flags you can provide to the command:

-  `--entandoversion` or `-v`: Specify the version of Entando to upgrade to.

-  `--namespace` or `-n`: Specify the namespace where Entando is currently installed.

All the flags are optional and only serve to bypass the provided guided inputs. If you don't specify them, you will just be prompted for the input.

## Sample Upgrade

Here's a sample command for the upgrade:

```bash

./upgrade-entando-v1.0.0-linux-x64 --entandoversion  7.3.0  --namespace  my-namespace

```

This will start the upgrade process to Entando version 7.3.0 in the `my-namespace` namespace.
Please, note that you will still be prompted for confirmations and additional options.

## Important Notes

- This CLI tool loads your initial Kubernetes configuration. Any subsequent change in context is limited in scope to the execution environment.

- The CLI will guide you through the upgrade process, and you can provide optional flags in advance to bypass some of the prompts.

- The CLI automates the entire process, but also creates the necessary files to complete the upgrade manually using the `kubectl kustomize` command. Instructions will be provided during the process.

- The upgrade process differs slightly between K8S and OCP clusters, but the CLI handles it entirely, detecting the type of cluster at the start of the process.

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](/LICENSE) file for details.