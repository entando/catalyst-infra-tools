import axios from 'axios'
import * as fs from 'node:fs/promises'

import {input, select} from '@inquirer/prompts'
import * as k8s from '@kubernetes/client-node'
import {Command, Flags} from '@oclif/core'

import Listr = require('listr');

export default class Upgrade extends Command {
  static description = 'The Upgrade Entando CLI is a command-line tool for simplifying the upgrade of Entando.' +
                       'This tool streamlines the process of upgrading to a newer version of Entando with a guided experience.' +
                       'All the flags are optional and only serve to bypass the provided guided inputs.';

  static summary = 'Upgrade Entando CLI';

  static flags = {
    entandoversion: Flags.string({
      char: 'v',
      description: 'The version of Entando to upgrade to',
    }),
    namespace: Flags.string({
      char: 'n',
      description: 'The namespace in which your EntandoApp is installed',
    }),
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(Upgrade)

    const tags: string[] = await getEntandoTags()

    let namespace: string
    let version = ''

    const kc = new k8s.KubeConfig()

    kc.loadFromDefault()

    let k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api)
    let k8sObjApi = kc.makeApiClient(k8s.KubernetesObjectApi)
    let k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api)

    let currentContext: string = kc.getCurrentContext()

    const now = new Date()
    const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`

    console.log('\nWelcome! Let\'s upgrade Entando together!')
    console.log('\n* NOTE')
    console.log('* This tool loads your initial Kubernetes configuration, but any subsequent change in context is only limited in scope to the execution environment.')

    if (currentContext === 'loaded-context') {
      console.log('\nWARNING:')
      console.log(`The loaded context '${currentContext}' and base path '${k8sCoreApi.basePath}' might indicate that your Kube Config isn't set correctly.`)
      await select({
        message: 'Is this configuration correct and do you still wish to continue?',
        choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
      }).then(answer => {
        if (!answer) {
          closeRun(this)
        }
      })
    }

    console.log(`\nYour current context is: ${currentContext}\n`)

    await select({
      message: 'Is this the context you want to use?',
      choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
    }).then(async answer => {
      if (!answer) {
        console.log('')
        const contexts: string[] = kc.getContexts().map((context: k8s.Context) => context.name)
        currentContext = await select({
          message: 'What context would you like to use?',
          choices: contexts.map(context => ({value: context})),
        })
        kc.setCurrentContext(currentContext)
        k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api)
        k8sObjApi = kc.makeApiClient(k8s.KubernetesObjectApi)
        k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api)
      }
    })

    console.log(`\nThe selected context is ${currentContext}`)

    let clusterType = ''
    let kubeCommand = 'kubectl'
    await k8sCoreApi.readNamespace('openshift').then(() => {
      clusterType = 'OCP'
      kubeCommand = 'oc'
    }).catch(error => {
      if (error.body.reason === 'Unauthorized') {
        console.log('\nIt seems like you are not logged in to your cluster. Please, login and then rerun the tool.')
        closeRun(this)
      } else {
        clusterType = 'K8S'
      }
    })

    console.log(`\nYour cluster is ${clusterType}.`)

    let namespaceExistsAndValid = false

    do {
      let exit = false
      if (flags.namespace) namespace = flags.namespace.toLowerCase()
      else {
        console.log('')
        namespace = (await input({message: 'Enter the target namespace:'})).toLowerCase()
      }

      await k8sCoreApi.readNamespace(namespace).then(async () => {
        await k8sObjApi.list('entando.org/v1', 'EntandoApp', namespace).then(async res => {
          if (res.body.items.length > 0) {
            namespaceExistsAndValid = true
          } else {
            console.log('')
            exit = await select({
              message: `The namespace '${namespace}' does not seem to have Entando installed. Do you want to try again?`,
              choices: [{value: false, name: 'Yes'}, {value: true, name: 'No'}],
            })
          }
        })
      })
      .catch(async () => {
        console.log('')
        exit = await select({
          message: `The namespace '${namespace}' does not exist. Do you want to try again?`,
          choices: [{value: false, name: 'Yes'}, {value: true, name: 'No'}],
        })
      })
      if (exit) closeRun(this)
    } while (!namespaceExistsAndValid)

    console.log(`\nThe target namespace is: ${namespace}`)

    if (flags.entandoversion && tags.includes(flags.entandoversion)) version = flags.entandoversion
    else if (flags.entandoversion && tags.includes(`v${flags.entandoversion}`)) version = `v${flags.entandoversion}`
    else if (flags.entandoversion) console.log(`\nThe Entando version you specified (${flags.entandoversion}) could not be found.\n`)
    else console.log('')

    let validVersion = true
    let validCatalog = true
    let installCatalog = ''
    let kustomizationPath = ''
    let catalogVersion = ''

    do {
      kustomizationPath = `https://raw.githubusercontent.com/entando/entando-releases/${version}/dist/ge-1-1-6/plain-templates/misc/kustomization-${clusterType}.yaml`
      if (version === '') {
        validVersion = false
      } else {
        await axios.get(kustomizationPath).then(async () => {
          validVersion = true
        }).catch(() => {
          validVersion = false
          console.log(`\nKustomization for selected version ${version} is not available. Please, pick a different one.\n`)
        })
      }

      if (validVersion === true && clusterType === 'OCP') {
        const catalogPath = `https://raw.githubusercontent.com/entando/entando-releases/${version}/dist/ge-1-1-6/samples/openshift-catalog-source.yaml`
        await axios.get(catalogPath).then(async catalogSource => {
          const catalogSourceYaml: any = k8s.loadYaml(catalogSource.data)
          catalogVersion = catalogSourceYaml.metadata!.name!
          await k8sObjApi.read(catalogSourceYaml).then(() => {
            validCatalog = true
          }).catch(async () => {
            validCatalog = false
            console.log(`\nCatalog for Entando ${version} not found.\n`)
            installCatalog = await select({
              message: 'Would you like to add the selected version\'s catalog to the marketplace?',
              choices: [{value: 'Yes'}, {value: 'No, change version'}, {value: 'No, close the program'}],
            })
            if (installCatalog === 'Yes') {
              console.log('')
              await checkSpecsAndApply([catalogSourceYaml])
              console.log(`\nAdded ${catalogVersion} to the Openshift Marketplace.`)
              validCatalog = true
            } else if (installCatalog.includes('change')) {
              console.log('')
            } else if (installCatalog.includes('close')) {
              closeRun(this)
            }
          })
        })
      } else if (validVersion === true && clusterType === 'K8S') {
        validCatalog = true
      }

      if (!validVersion || !validCatalog) {
        version = await select({
          message: 'What version of Entando do you wish to upgrade to?',
          choices: tags.map(tag => ({value: tag})),
          loop: false,
          pageSize: 10,
        })
      }
    } while (!validVersion || !validCatalog)

    console.log(`\nThe selected Entando version is ${version}\n`)

    let basePath: (string|undefined) = await select({
      message: `You are here: '${process.cwd()}'. Do you want to create a directory here?`,
      choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
    }) ? process.cwd() :
      (await select({
        message: 'Do you want to specify a custom path?',
        choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
      }) ? await input({message: 'Enter your custom path:'}) : undefined)

    if (basePath === undefined) {
      closeRun(this)
    } else {
      while (basePath.endsWith('/')) {
        basePath = basePath.slice(0, -1)
      }
    }

    console.log('\nNow we are going to create directories to store the configuration files.\n')

    const path = `${basePath}/entando-upgrade-${namespace}-${date}`
    const baseDirectory = `${path}/base`
    const overlayDirectory = `${path}/overlay`
    const newDeploymentsDirectory = `${overlayDirectory}/new-deployments`
    const directories = [path, baseDirectory, overlayDirectory]

    await createDirectories(directories)

    console.log(`\nNow we are going to scale down all deployments in the namespace '${namespace}'.\n`)

    await k8sAppsApi.listNamespacedDeployment(namespace).then(async res => {
      await scaleDeployments(res.body.items, 0)
    })

    console.log(`\nNow we are going to create the backup files of the current deployments\n(${baseDirectory})\n`)

    const deployments: k8s.V1Deployment[] = []

    await k8sAppsApi.listNamespacedDeployment(namespace).then(async res => {
      for (const deployment of res.body.items) {
        await k8sAppsApi.readNamespacedDeployment(deployment.metadata!.name!, namespace).then(response => {
          const body = response.body
          if (body.spec?.template.spec?.containers[0].image!.startsWith('docker.io')) {
            body.spec!.template.spec!.containers[0].image = body.spec!.template.spec!.containers[0].image?.replace('docker.io', 'registry.hub.docker.com')
          } else if (body.spec?.template.spec?.containers[0].image!.startsWith('entando')) {
            body.spec!.template.spec!.containers[0].image = body.spec!.template.spec!.containers[0].image?.replace('entando', 'registry.hub.docker.com/entando')
          }

          deployments.push(body)
        })
      }
    })

    await createYamlFiles(deployments, baseDirectory)

    let subscription: any
    let clusterServiceVersion: any
    let operatorBackupDirectory = ''
    if (clusterType === 'OCP') {
      operatorBackupDirectory = `${baseDirectory}/operator`
      console.log('\nNow we are going to create the backup files for the currently installed Operator\n')
      await k8sObjApi.list('operators.coreos.com/v1alpha1', 'Subscription', namespace).then(async res => {
        const item: any = res.body.items[0]
        await k8sObjApi.read(item).then(async response => {
          subscription = response.body
        })
      })
      await k8sObjApi.list('operators.coreos.com/v1alpha1', 'ClusterServiceVersion', namespace).then(async res => {
        const item: any = res.body.items[0]
        await k8sObjApi.read(item).then(async response => {
          clusterServiceVersion = response.body
        })
      })
      await createDirectories([operatorBackupDirectory])
      console.log('')
      await createYamlFiles([subscription, clusterServiceVersion], operatorBackupDirectory)
    }

    console.log(`\nNow we are going to create the Kustomization file\n(${baseDirectory})\n`)

    const kustomizeYamlBase = 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\n\nresources:\n'

    const createKustomizationBaseFileTask = new Listr([{
      title: 'Creating the \'kustomization.yaml\' file',
      task: async () => {
        let kustomizeYaml = kustomizeYamlBase
        for (const deployment of deployments) {
          if (clusterType !== 'OCP' || (deployment.metadata!.name !== 'entando-operator' && deployment.metadata!.name !== 'entando-k8s-service')) {
            kustomizeYaml += `  - ${deployment.metadata!.name}.yaml\n`
          }
        }

        await fs.writeFile(`${baseDirectory}/kustomization.yaml`, kustomizeYaml)
      },
    }])

    await createKustomizationBaseFileTask.run()

    console.log(`\nNow we are going to create the Kustomization file for the upgrade\n(${overlayDirectory})\n`)

    const createKustomizationOverlayFileTask = new Listr([{
      title: 'Creating the \'kustomization.yaml\' file',
      task: async () => {
        let kustomizeYaml = kustomizeYamlBase
        kustomizeYaml += `  - ../base\n\nnamespace: ${namespace}\n\nimages:\n\n`
        await axios.get(kustomizationPath).then(async response => {
          const kustomizationResources = response.data
          kustomizeYaml += kustomizationResources
          await fs.writeFile(`${overlayDirectory}/kustomization.yaml`, kustomizeYaml)
        }).catch(() => {
          throw new Error(`Failed fetching kustomization-${clusterType}.yaml for Entando ${version}`)
        })
      },
    }])

    await createKustomizationOverlayFileTask.run()

    console.log('\nEverything is ready for the upgrade!\n')
    if (clusterType === 'OCP') {
      console.log('* NOTE\n* Since you are on OpenShift, the \'entando-operator\' and \'entando-k8s-service\' deployments are managed by the Operator.')
      console.log('* Therefore, to complete the upgrade, the currently installed operator needs to be uninstalled, in order to install the new one.')
      console.log('')
    }

    const apply = await select({
      message: 'Would you like this tool to apply the upgrade, or do you prefer to continue manually?',
      choices: [{value: true, name: 'Apply the upgrade'}, {value: false, name: 'I want to do it manually'}],
    })

    if (apply) {
      console.log('\nStarting the upgrade process.')
      if (clusterType === 'OCP') {
        console.log('\nNow we are going to uninstall the current operator, and install the new one.\n')
        const replaceOperatorTask = new Listr([
          {
            title: `Uninstalling operator ${clusterServiceVersion.metadata.name}`,
            task: async () => {
              await k8sObjApi.delete(subscription).catch(() => {
                throw new Error(`Error while uninstalling ${subscription.metadata.name}`)
              })
              await k8sObjApi.delete(clusterServiceVersion).catch(() => {
                throw new Error(`Error while uninstalling ${clusterServiceVersion.metadata.name}`)
              })
            },
          },
          {
            title: `Installing the new operator for ${catalogVersion}`,
            task: async () => {
              const newSubscription = 'apiVersion: operators.coreos.com/v1alpha1\n' +
                                    'kind: Subscription\n' +
                                    'metadata:\n' +
                                    '  name: entando-k8s-operator\n' +
                                    `  namespace: ${namespace}\n` +
                                    'spec:\n' +
                                    '  channel: final\n' +
                                    '  installPlanApproval: Automatic\n' +
                                    '  name: entando-k8s-operator\n' +
                                    `  source: ${catalogVersion}\n` +
                                    '  sourceNamespace: openshift-marketplace\n' +
                                    `  startingCSV: entando-k8s-operator.${version}`
              const newSubscriptionYaml: k8s.KubernetesObject = k8s.loadYaml(newSubscription)
              await k8sObjApi.create(newSubscriptionYaml).then(async () => {
                let ready = false
                do {
                  await k8sObjApi.list('operators.coreos.com/v1alpha1', 'ClusterServiceVersion', namespace).then(async res => {
                    const csv: any = res.body.items[0]
                    await k8sObjApi.read(csv).then(async response => {
                      const readCsv: any = response.body
                      ready = readCsv.status.phase === 'Succeeded'
                    })
                  }).catch(() => {
                    ready = false
                  })
                  if (!ready) await new Promise(resolve => {
                    setTimeout(resolve, 3000)
                  })
                } while (!ready)
              }).catch(() => {
                throw new Error('Error while installing the operator')
              })
            },
          },
        ])

        await replaceOperatorTask.run()

        console.log('\nScaling down the deployments created by the new operator.\n')

        await k8sAppsApi.listNamespacedDeployment(namespace).then(async res => {
          const items = res.body.items
          await scaleDeployments(items.filter(item => item.spec!.replicas === 1), 0)
        })
      }

      console.log('\nNow we are going to update the deployments.\n')
      await kustomizeDeployments(deployments, `${overlayDirectory}/kustomization.yaml`, baseDirectory)
      let deploymentsToScaleUp: k8s.V1Deployment[] = []
      await k8sAppsApi.listNamespacedDeployment(namespace).then(async res => {
        deploymentsToScaleUp = res.body.items
      })
      if (clusterType === 'OCP') {
        console.log('')
        await select({
          message: 'Were there environment variables in your entando-operator or entando-k8s-service that need to be reapplied? (In case you answer \'No\' here, you can still find them in the previously created backups)',
          choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
        }).then(async answer => {
          if (answer) {
            const serviceDeployment = deployments.find(deployment => deployment.metadata!.name === 'entando-k8s-service')
            const operatorDeployment = deployments.find(deployment => deployment.metadata!.name === 'entando-operator')
            const serviceEnv: any = serviceDeployment?.spec?.template.spec?.containers[0].env
            const operatorEnv: any = operatorDeployment?.spec?.template.spec?.containers[0].env
            await k8sObjApi.list('operators.coreos.com/v1alpha1', 'ClusterServiceVersion', namespace).then(async res => {
              const csv: any = res.body.items[0]
              await k8sObjApi.read(csv).then(async response => {
                const editedCsv: any = response.body
                const csvOperatorEnv: any = editedCsv.spec.install.spec.deployments[0].spec.template.spec.containers[0].env
                for (const variable of operatorEnv) {
                  if (variable.name !== 'ENTANDO_K8S_OPERATOR_VERSION' && variable.name !== 'OPERATOR_CONDITION_NAME' && variable.name !== 'OPERATOR_NAME' && !variable.name.includes('RELATED_IMAGE_')) {
                    const correspondingIndex = csvOperatorEnv.findIndex((element: any) => element.name === variable.name)
                    if (correspondingIndex === -1) {
                      csvOperatorEnv.push(variable)
                    } else {
                      if (Object.prototype.hasOwnProperty.call(csvOperatorEnv[correspondingIndex], 'value')) csvOperatorEnv[correspondingIndex].value = variable.value
                      if (Object.prototype.hasOwnProperty.call(csvOperatorEnv[correspondingIndex], 'valueFrom')) csvOperatorEnv[correspondingIndex].valueFrom = variable.valueFrom
                    }
                  }
                }

                const csvServiceEnv: any = editedCsv.spec.install.spec.deployments[1].spec.template.spec.containers[0].env
                for (const variable of serviceEnv) {
                  if (variable.name !== 'OPERATOR_CONDITION_NAME' && variable.name !== 'OPERATOR_NAME') {
                    const correspondingIndex = csvServiceEnv.findIndex((element: any) => element.name === variable.name)
                    if (correspondingIndex === -1) {
                      csvServiceEnv.push(variable)
                    } else {
                      if (Object.prototype.hasOwnProperty.call(csvServiceEnv[correspondingIndex], 'value')) csvServiceEnv[correspondingIndex].value = variable.value
                      if (Object.prototype.hasOwnProperty.call(csvServiceEnv[correspondingIndex], 'valueFrom')) csvServiceEnv[correspondingIndex].valueFrom = variable.valueFrom
                    }
                  }
                }

                delete editedCsv.metadata?.managedFields

                const updateCSVTask = new Listr([
                  {
                    title: `Updating ${editedCsv.metadata.name} in ${editedCsv.metadata.namespace}`,
                    task: async () => {
                      await k8sObjApi.replace(editedCsv).catch(() => {
                        throw new Error(`Error while updating ${editedCsv.metadata.name}`)
                      })
                    },
                  },
                ])

                await updateCSVTask.run()

                deploymentsToScaleUp = deploymentsToScaleUp.filter(deployment => (deployment.metadata!.name !== 'entando-operator') && (deployment.metadata!.name !== 'entando-k8s-service'))
              })
            })
          }
        })
      }

      console.log('\nAll done! Now we are going to scale your deployments up again.\n')
      await scaleDeployments(deploymentsToScaleUp, 1)
      console.log('\nFinally, we are going to create a backup of the new patched deployments\n')

      await createDirectories([newDeploymentsDirectory])
      console.log('')

      const newDeployments: k8s.V1Deployment[] = []

      await k8sAppsApi.listNamespacedDeployment(namespace).then(async res => {
        for (const deployment of res.body.items) {
          await k8sAppsApi.readNamespacedDeployment(deployment.metadata!.name!, namespace).then(response => {
            const body = response.body
            newDeployments.push(body)
          })
        }
      })

      await createYamlFiles(newDeployments, newDeploymentsDirectory)
    } else {
      console.log('\nUnderstood!')
      console.log(`\nYou can check the created resources in\n  '${path}'\nand apply the upgrade by navigating to\n  '${overlayDirectory}'\nand executing:`)
      console.log(`\n  ${kubeCommand} kustomize | ${kubeCommand} apply -f -\n\nor\n\n  ${kubeCommand} apply -k .`)
      if (clusterType === 'OCP') {
        console.log(`\n* NOTE\n* To complete the upgrade, remember to also uninstall the currently installed operator, and to install the new one (${catalogVersion})`)
        console.log('* Otherwise, the deployments for \'entando-operator\' and \'entando-k8s-service\' will not be upgraded.')
      }

      console.log('\nAfterwards, you can scale your deployments up again by executing:')
      console.log(`\n  ${kubeCommand} scale deploy --all -n ${namespace} --replicas=1`)
    }

    console.log(`\nIn case you want to restore the previous deployment, you can find the backups in\n  '${baseDirectory}'\nand apply them executing:`)
    console.log(`\n  ${kubeCommand} kustomize | ${kubeCommand} apply -f -\n\nor\n\n  ${kubeCommand} apply -k .`)
    if (clusterType === 'OCP') {
      console.log('\n* NOTE\n* Since you are on OpenShift, the \'entando-operator\' and \'entando-k8s-service\' deployments are managed by the Operator.')
      console.log('* Therefore, to get back to the previous version, the upgraded installed operator needs to be uninstalled, in order to install the previous one.')
    }

    console.log('\n------------------------------------------------------------------------------')
    console.log('\n* REMINDER\n* Please, note that this program does not change your environment\'s Kubernetes configuration (e.g.: context, namespace).')
    console.log('* As such, you may need to run')
    console.log(`*\n*   ${kubeCommand} config use-context ${currentContext}`)
    console.log('*\n* and/or')
    console.log(`*\n*   ${kubeCommand} config set-context --current --namespace=${namespace}`)
    console.log('*\n* before executing the apply commands, in case your context at the start of the execution was different.')
    console.log('\nThank you for having used this tool! Have a good rest of the day!\n')

    async function checkSpecsAndApply(specs: any[]) {
      const validSpecs = specs.filter(spec => spec && spec.kind && spec.metadata)
      for (const spec of validSpecs) {
        if (spec.metadata && !spec.metadata.namespace) {
          spec.metadata.namespace = namespace
        }

        try {
          await k8sObjApi.read(spec)

          const updateTask = new Listr([
            {
              title: `Updating ${spec.metadata.name} in ${spec.metadata.namespace}`,
              task: async () => {
                await k8sObjApi.patch(spec).catch(() => {
                  throw new Error(`Error while updating ${spec.metadata.name}`)
                })
              },
            },
          ])

          await updateTask.run()
        } catch {
          const createTask = new Listr([
            {
              title: `Creating ${spec.metadata.name} in ${spec.metadata.namespace}`,
              task: async () => {
                await k8sObjApi.create(spec).catch(() => {
                  throw new Error(`Error while creating ${spec.metadata.name}`)
                })
                let ready = false
                do {
                  await k8sObjApi.read(spec).then(async res => {
                    const response: any = res.body
                    if (response.status.connectionState) {
                      ready = response.status.connectionState.lastObservedState === 'READY'
                    }

                    if (!ready) await new Promise(resolve => {
                      setTimeout(resolve, 3000)
                    })
                  })
                } while (!ready)
              },
            },
          ])

          await createTask.run()
        }
      }
    }

    async function kustomizeDeployments(deployments: k8s.V1Deployment[], kustomizationFilePath: string, baseDeploymentsPath: string) {
      const kustomization = await fs.readFile(kustomizationFilePath, 'utf8')
      const kustomizationYaml: { images: { name: string, newName: string, newTag?: string, digest?: string }[]} = k8s.loadYaml(kustomization)
      const updatedDeployments: k8s.V1Deployment[] = []
      for (const deployment of deployments) {
        if (clusterType !== 'OCP' || (deployment.metadata!.name !== 'entando-operator' && deployment.metadata!.name !== 'entando-k8s-service')) {
          const file = await fs.readFile(`${baseDeploymentsPath}/${deployment.metadata?.name}.yaml`, 'utf8')
          const yamlFile: k8s.V1Deployment = k8s.loadYaml(file)
          const separator = clusterType === 'OCP' ? '@' : ':'
          const correspondingImage = kustomizationYaml.images.find(image => image.name === yamlFile.spec?.template.spec?.containers[0].image!.split(separator)[0])
          if (correspondingImage && yamlFile.spec && yamlFile.spec.template.spec && yamlFile.spec.template.spec.containers[0].image) {
            let replaceValue = ''
            if (correspondingImage.digest) replaceValue = correspondingImage.digest
            if (correspondingImage.newTag) replaceValue = correspondingImage.newTag
            yamlFile.spec.template.spec.containers[0].image = yamlFile.spec.template.spec.containers[0].image.replace(yamlFile.spec.template.spec.containers[0].image.split(separator)[1], replaceValue).replace(yamlFile.spec.template.spec.containers[0].image.split(separator)[0], correspondingImage.newName)
            if (yamlFile.spec && yamlFile.spec.template.metadata && yamlFile.spec.template.metadata.annotations && yamlFile.spec.template.metadata.annotations.containerImage) {
              const containerImage = kustomizationYaml.images.find(image => image.name === yamlFile.spec?.template.metadata?.annotations?.containerImage.split(separator)[0])
              let replaceContainerImage = ''
              if (containerImage && containerImage.digest) replaceContainerImage = containerImage.digest
              if (containerImage && containerImage.newTag) replaceContainerImage = containerImage.newTag
              if (containerImage) yamlFile.spec.template.metadata.annotations.containerImage = yamlFile.spec.template.metadata.annotations.containerImage.replace(yamlFile.spec.template.metadata.annotations.containerImage.split(separator)[0], containerImage.newName).replace(yamlFile.spec.template.metadata.annotations.containerImage.split(separator)[1], replaceContainerImage)
            }

            updatedDeployments.push(yamlFile)
          }
        }
      }

      await checkSpecsAndApply(updatedDeployments)
    }

    async function createYamlFiles(objects: any[], path: string) {
      const tasks: Listr.ListrTask[] = []
      for (const object of objects) {
        tasks.push({
          title: `Creating file '${object.metadata!.name}.yaml'`,
          task: async () => {
            delete object.metadata?.managedFields
            delete object.metadata?.resourceVersion
            const yamlFile = k8s.dumpYaml(object)
            await fs.writeFile(`${path}/${object.metadata!.name}.yaml`, yamlFile)
          },
        })
      }

      const createYamlTask = new Listr(tasks)
      await createYamlTask.run()
    }

    async function createDirectories(folders: string[]) {
      const tasks: Listr.ListrTask[] = []
      for (const folder of folders) {
        tasks.push({
          title: `Creating folder '${folder}'`,
          task: async () => {
            await fs.mkdir(folder, {recursive: true}).catch(() => {
              throw new Error(`Error while creating folder '${folder}'`)
            })
          },
        })
      }

      const mkdirTask = new Listr(tasks)
      await mkdirTask.run()
    }

    async function scaleDeployments(items: k8s.V1Deployment[], replicas: number) {
      const tasks: Listr.ListrTask[] = []
      const scale = (replicas === 0 ? 'down' : 'up')
      for (const item of items) {
        tasks.push({
          title: `Scaling ${scale} deployment '${item.metadata!.name}'`,
          task: async () => {
            const res = await k8sAppsApi.readNamespacedDeployment(item.metadata!.name!, namespace)
            const deployment = res.body
            deployment.spec!.replicas = replicas
            await k8sAppsApi.replaceNamespacedDeployment(item.metadata!.name!, namespace, deployment)
            let ready = false
            do {
              await k8sAppsApi.readNamespacedDeploymentStatus(item.metadata!.name!, namespace).then(async res => {
                ready = replicas === 1 ? res.body.status?.readyReplicas === replicas : res.body.status?.readyReplicas === undefined
                if (!ready) await new Promise(resolve => {
                  setTimeout(resolve, 3000)
                })
              })
            } while (!ready)
          },
        })
      }

      const scaleTask = new Listr(tasks, {concurrent: true})
      await scaleTask.run()
      console.log(`\nScaled ${scale} all your deployments!`)
    }

    async function getEntandoTags(): Promise<string[]> {
      try {
        const response = await axios.get('https://api.github.com/repos/entando/entando-releases/tags?per_page=200')
        const tags: string[] = response.data.map((tag: any) => tag.name)
        return tags
      } catch {
        throw new Error('Error fetching Entando tags')
      }
    }

    function closeRun(run: Upgrade) {
      console.log('\nExiting the program.\nHave a good rest of the day!\n')
      run.exit()
    }
  }
}
