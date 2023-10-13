
# Install Entando CLI v1.0.0

The Install Entando CLI is a command-line tool for simplifying the installation of Entando. This tool streamlines the installation process and provides a guided experience to set up Entando in your Kubernetes cluster.

## Installation

The Install Entando CLI is not available on npm. Instead, you can download the binary distribution for your OS and architecture from the [releases](https://github.com/entando/catalyst-infra-tools/releases?q=install-entando&expanded=true) page. The binary files are named in the following format:

- Linux: `install-entando-v1.0.0-linux-arm64` | `install-entando-v1.0.0-linux-x64`

- macOS: `install-entando-v1.0.0-macos-arm64` | `install-entando-v1.0.0-macos-x64`

- Windows: `install-entando-v1.0.0-windows-arm64.exe` | `install-entando-v1.0.0-windows-x64.exe`

Once you've downloaded the appropriate binary for your system, you can run it from the command line.

## Usage

To use the Install Entando CLI, follow these steps:

1. Download the binary for your OS and architecture as mentioned in the installation section.

2. Open a terminal and navigate to the directory where you downloaded the binary.

3. Make sure that the binary is executable (Linux and MacOS) and then run the CLI.

```bash

$ chmod +x install-entando-v1.0.0-linux-x64

$ ./install-entando-v1.0.0-linux-x64

```

Replace `./install-entando-v1.0.0-linux-x64` with the actual name of the binary you downloaded.

4. The CLI will guide you through the installation process.

## Command Flags

Here are the available flags you can provide to the command:

-  `--entandoversion` or `-v`: Specify the version of Entando to install.

-  `--namespace` or `-n`: Specify the namespace in which to install Entando.

-  `--project` or `-p`: Specify the name of the project to deploy.

-  `--hostname` or `-h`: Specify the hostname to use for the Entando app.

-  `--tls` or `-t`: Enable or disable TLS for the installation.

-  `--local` or `-l`: Specify whether you want to install Entando locally or in a cluster.

All the flags are optional and only serve to bypass the provided guided inputs. If you don't specify them, you will just be prompted for the input.

## Sample Installation

Here's a sample installation command:

```bash

./install-entando-v1.0.0-linux-x64 --entandoversion  7.2.2  --namespace  my-namespace  --project  my-project  --hostname  my-entando-app.nip.io  --tls --local

```

This will start the installation process for Entando version 7.2.2 in the `my-namespace` namespace, with the project name `my-project`, using the hostname `my-entando-app.nip.io` with TLS enabled in a local environment.
Please, note that you will still be prompted for confirmations and additional options.

## Important Notes

- This CLI tool loads your initial Kubernetes configuration. Any subsequent change in context is limited in scope to the execution environment.

- The CLI will guide you through the installation process, and you can provide optional flags in advance to bypass some of the prompts.

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](/LICENSE) file for details.