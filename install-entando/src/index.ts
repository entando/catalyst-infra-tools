import axios from 'axios'
import * as fs from 'node:fs/promises'

import {input, select} from '@inquirer/prompts'
import * as k8s from '@kubernetes/client-node'
import {Command, Flags} from '@oclif/core'

import Listr = require('listr');

export default class Install extends Command {
  static description = 'The Install Entando CLI is a command-line tool for simplifying the installation of Entando. ' +
                       'This tool streamlines the installation process and provides a guided experience to set up Entando in your Kubernetes cluster.' +
                       'All the flags are optional and only serve to bypass the provided guided inputs.';

  static summary = 'Install Entando CLI';

  static flags = {
    entandoversion: Flags.string({
      char: 'v',
      description: 'The version of Entando to install',
    }),
    namespace: Flags.string({
      char: 'n',
      description: 'The namespace in which to install Entando',
    }),
    project: Flags.string({
      char: 'p',
      description: 'The name of the project to deploy',
    }),
    hostname: Flags.string({
      char: 'h',
      description: 'The hostname to use for the Entando app',
    }),
    tls: Flags.boolean({
      char: 't',
      description: 'Whether you want to use TLS or not',
    }),
    local: Flags.boolean({
      char: 'l',
      description: 'Whether you want to install Entando locally or in a cluster',
    }),
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(Install)

    const tags: string[] = await getEntandoTags()

    let namespace: string
    let version: string
    let projectName: string
    let ingressHostname: string
    let tls: boolean
    let local: boolean

    const kc = new k8s.KubeConfig()

    kc.loadFromDefault()

    let k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api)
    let k8sObjApi = kc.makeApiClient(k8s.KubernetesObjectApi)

    let currentContext: string = kc.getCurrentContext()

    const now = new Date()
    const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`

    console.log('\nWelcome! Let\'s install Entando together!')
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
      }
    })

    console.log(`\nThe selected context is ${currentContext}`)

    if (flags.namespace) namespace = flags.namespace.toLowerCase()
    else {
      console.log('')
      namespace = (await input({message: 'Enter the target namespace:'})).toLowerCase()
    }

    let namespaceExists = false

    do {
      await k8sCoreApi.readNamespace(namespace).then(() => {
        namespaceExists = true
      })
      .catch(async () => {
        console.log('')
        const create: boolean = await select({
          message: `The namespace '${namespace}' does not exist. Do you want to create it?`,
          choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
        })
        if (create) {
          console.log('')
          const createNamespaceTask = new Listr([
            {
              title: `Creating namespace '${namespace}'`,
              task: async () => {
                await k8sCoreApi.createNamespace({metadata: {name: namespace}}).catch(() => {
                  throw new Error(`Error while creating namespace '${namespace}'`)
                })
              },
            },
          ])

          await createNamespaceTask.run()
        } else {
          closeRun(this)
        }
      })
    } while (!namespaceExists)

    console.log(`\nThe target namespace is: ${namespace}`)

    if (flags.entandoversion && tags.includes(flags.entandoversion)) version = flags.entandoversion
    else if (flags.entandoversion && tags.includes(`v${flags.entandoversion}`)) version = `v${flags.entandoversion}`
    else {
      if (flags.entandoversion) console.log(`\nThe Entando version you specified (${flags.entandoversion}) could not be found.\n`)
      else console.log('')
      version = await select({
        message: 'What version of Entando do you wish to install?',
        choices: tags.map(tag => ({value: tag})),
        loop: false,
        pageSize: 10,
      })
    }

    console.log(`\nThe selected Entando version is ${version}`)

    const clusterResourcesPath = `https://raw.githubusercontent.com/entando/entando-releases/${version}/dist/ge-1-1-6/namespace-scoped-deployment/cluster-resources.yaml`
    const namespaceResourcesPath = `https://raw.githubusercontent.com/entando/entando-releases/${version}/dist/ge-1-1-6/namespace-scoped-deployment/namespace-resources.yaml`
    const entandoOperatorPath = `https://raw.githubusercontent.com/entando/entando-releases/${version}/dist/ge-1-1-6/samples/entando-operator-config.yaml`

    let namespaceResources = ''
    let clusterResources = ''
    let entandoOperator = ''

    await axios.get(namespaceResourcesPath).then(response => {
      namespaceResources = response.data
    }).catch(() => {
      throw new Error(`Failed fetching namespace-resources.yaml for Entando ${version}`)
    })

    await axios.get(clusterResourcesPath).then(response => {
      clusterResources = response.data
    }).catch(() => {
      throw new Error(`Failed fetching cluster-resources.yaml for Entando ${version}`)
    })

    await axios.get(entandoOperatorPath).then(response => {
      entandoOperator = response.data
    }).catch(() => {
      throw new Error(`Failed fetching entando-operator-config.yaml for Entando ${version}`)
    })

    let crdsExist = false
    const crds: any[] = k8s.loadAllYaml(clusterResources)
    const validCrds = crds.filter(spec => spec && spec.kind && spec.metadata)

    do {
      const checkCdrTask = new Listr([
        {
          title: 'Checking Entando CRDs',
          task: async () => {
            for (const crd of validCrds) {
              try {
                await k8sObjApi.read(crd)
              } catch {
                throw new Error(`${crd.metadata.name} not found`)
              }
            }

            crdsExist = true
          },
        },
      ], {exitOnError: false})

      console.log('')
      await checkCdrTask.run().catch(async () => {
        console.log('')
        const crdsInstall: boolean = await select({
          message: 'One or more of the Entando CRDs are missing. Do you have cluster permission and do you want to install them?',
          choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
        })
        if (crdsInstall) {
          await checkSpecsAndApply(validCrds)
        } else {
          closeRun(this)
        }
      })
    } while (!crdsExist)

    console.log('\nEntando CRDs are installed, so we can go on.\n')

    await k8sObjApi.list('entando.org/v1', 'EntandoApp', namespace).then(res => {
      if (res.body.items.length > 0) {
        console.log(`It appears an EntandoApp called '${res.body.items[0].metadata?.name}' already exists in namespace '${namespace}'.`)
        closeRun(this)
      }
    })

    await select({
      message: `Namespace-scoped resources for Entando ${version} will be applied to the namespace ${namespace}. Continue? (They will be patched if already existing)`,
      choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
    }).then(answer => {
      if (answer) {
        console.log('')
      } else {
        closeRun(this)
      }
    })

    console.log(`Now installing namespace-scoped resources for Entando ${version}...\n`)

    let nsResources: k8s.KubernetesObject[] = k8s.loadAllYaml(namespaceResources)
    await checkSpecsAndApply(nsResources)

    console.log('')

    const path: (string|undefined) = await select({
      message: `You are here: '${process.cwd()}'. Do you want to create a directory here?`,
      choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
    }) ? process.cwd() :
      (await select({
        message: 'Do you want to specify a custom path?',
        choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
      }) ? await input({message: 'Enter your custom path:'}) : undefined)

    if (path === undefined) {
      closeRun(this)
    }

    if (flags.project) projectName = flags.project
    else {
      console.log('')
      projectName = await input({message: 'Please, specify a project name:'})
    }

    const projectFolder = `entando-${projectName}-${namespace}-${date}`
    let projectPath = `${path}/${projectFolder}`

    console.log(`\nThe project name is '${projectName}'\n`)

    const mkdirTask = new Listr([
      {
        title: `Creating ${projectFolder}`,
        task: async () => {
          await fs.mkdir(projectPath).catch(() => {
            throw new Error(`Error while creating folder '${projectFolder}'`)
          })
        },
      },
    ])

    await mkdirTask.run()

    projectPath = await fs.realpath(projectPath)
    console.log(`\nThe directory has been created here: '${projectPath}'`)

    if (flags.hostname) ingressHostname = flags.hostname
    else {
      console.log('')
      ingressHostname = await input({message: 'Please, enter the ingress hostname you want to use:'})
    }

    console.log(`\nThe selected hostname is '${ingressHostname}'`)

    if (flags.tls) tls = flags.tls
    else {
      console.log('')
      tls = await select({
        message: 'Would you like to use TLS for your Entando installation?',
        choices: [{value: true, name: 'Yes'}, {value: false, name: 'No'}],
      })
    }

    console.log(`\nYou chose ${tls ? '' : 'not '}to use TLS.`)

    if (flags.local) local = flags.local
    else {
      console.log('')
      local = await select({
        message: 'Are you installing Entando in a Kubernetes cluster or in a local environment (e.g. minikube, k3s)?',
        choices: [{value: false, name: 'Kubernetes cluster'}, {value: true, name: 'Local environment'}],
      })
    }

    console.log(`\nYou are installing Entando in a ${local ? 'local environment' : 'Kubernetes cluster'}.\n`)

    const manifestTask = new Listr([
      {
        title: 'Generating the Operator ConfigMap',
        task: async () => {
          const operatorYaml: any = k8s.loadYaml(entandoOperator)
          operatorYaml.data['entando.requires.filesystem.group.override'] = 'true'
          operatorYaml.data['entando.ingress.class'] = 'nginx'
          entandoOperator = k8s.dumpYaml(operatorYaml)

          let setTlsLine = `  entando.tls.secret.name: ${projectName}-tls-secret\n`
          let limitsLine = '  entando.k8s.operator.impose.limits: \'true\'\n'
          if (!tls) setTlsLine = '#' + setTlsLine
          if (local) limitsLine = '#' + limitsLine

          entandoOperator = entandoOperator +
                '\n# More..\n' +
                '#  entando.k8s.operator.image.pull.secrets: sample-pull-secret\n' +
                '#  entando.docker.registry.override: \'docker.io\'\n' +
                setTlsLine +
                '#  entando.ca.secret.name: sample-ca-cert-secret\n' +
                '#  entando.assume.external.https.provider: \'true\'\n' +
                limitsLine

          await fs.writeFile(`${projectPath}/entando-operator-config.yaml`, entandoOperator)
        },
      },
      {
        title: 'Generating the base EntandoApp manifest',
        task: async () => {
          const entandoApp: string = '---\n' +
                'apiVersion: entando.org/v1\n' +
                'kind: EntandoApp\n' +
                'metadata:\n' +
                `  namespace: ${namespace}\n` +
                `  name: ${projectName}\n` +
                'spec:\n' +
                '  dbms: postgresql\n' +
                `  ingressHostName: ${ingressHostname}\n` +
                '  standardServerImage: tomcat\n' +
                '  environmentVariables:\n' +
                '    - name: MAX_RAM_PERCENTAGE\n' +
                '      value: \'75\'\n' +
                '  replicas: 1\n' +
                '  resourceRequirements:\n' +
                '    requests:\n' +
                '      cpu: \'100m\'\n' +
                '      memory: \'448Mi\'\n' +
                '    limits:\n' +
                '      cpu: \'1500m\'\n' +
                '      memory: \'3Gi\'\n' +
                '---\n' +
                '#apiVersion: entando.org/v1\n' +
                '#kind: EntandoDatabaseService\n' +
                '#metadata:\n' +
                `#  name: '${projectName}-ds'\n` +
                '#  annotations:\n' +
                '#    entando.org/controller-image: entando-k8s-database-service-controller\n' +
                '#    entando.org/supported-capabilities: mysql.dbms,oracle.dbms,postgresql.dbms,dbms\n' +
                '#  labels:\n' +
                '#    entando.org/crd-of-interest: EntandoDatabaseService\n' +
                '#spec:\n' +
                '#  dbms: postgresql\n' +
                '#  provisioningStrategy: UseExternal\n' +
                '#  host:\n' +
                '#  port: 5432\n' +
                `#  databaseName: ${projectName}_db\n` +
                '#  secretName: postgresql-secret\n' +
                '#  providedCapabilityScope: Namespace\n' +
                '#  replicas: 1\n'

          await fs.writeFile(`${projectPath}/entando-${projectName}-app.yaml`, entandoApp)
        },
      },
      {
        title: 'Generating the postgres-sql secret',
        task: async () => {
          const postgresSecret: string =
                '#apiVersion: v1\n' +
                '#kind: Secret\n' +
                '#metadata:\n' +
                '#  name: postgresql-secret\n' +
                '#stringData:\n' +
                '#  username: postgres\n' +
                '#  password: postgres\n'

          await fs.writeFile(`${projectPath}/postgres-secret.yaml`, postgresSecret)
        },
      },
      {
        title: 'Generating the TLS certificate request',
        task: async () => {
          const tlsSecret: string =
                'apiVersion: cert-manager.io/v1\n' +
                'kind: Certificate\n' +
                'metadata:\n' +
                `  name: ${projectName}-tls-secret\n` +
                `  namespace: ${namespace}\n` +
                'spec:\n' +
                `  secretName: ${projectName}-tls-secret\n` +
                '  issuerRef:\n' +
                '    group: cert-manager.io\n' +
                '    kind: ClusterIssuer\n' +
                '    name: letsencrypt-prod-cluster\n' +
                '  dnsNames:\n' +
                `  - ${ingressHostname}\n` +
                '  usages:\n' +
                '  - digital signature\n' +
                '  - key encipherment\n'

          await fs.writeFile(`${projectPath}/${projectName}-tls-cert.yaml`, tlsSecret)
        },
      },
      {
        title: 'Generating the file to restart the installation in case it stops',
        task: async () => {
          const redeploy: string =
                'metadata:\n' +
                '  annotations:\n' +
                '    entando.org/processing-instruction: force\n'

          await fs.writeFile(`${projectPath}/redeploy.yaml`, redeploy)
        },
      },
      {
        title: 'Saving a backup of the namespace resources',
        task: async () => {
          await fs.writeFile(`${projectPath}/namespace-resources.yaml`, namespaceResources)
        },
      },
    ])

    await manifestTask.run().catch(error => {
      throw new Error(`Error while creating the file '${error.path}'`)
    })

    console.log('\nAll resources have been created!\n')

    const applyResources = await select({
      message: 'Now, do you want this program to apply the resources and start the deployment? (If you want, you can go edit the files now, before applying them)',
      choices: [{value: 'Yes, please'}, {value: 'Yes, and re-apply namespace resources too'}, {value: 'No, I will do it myself'}],
    })

    if (applyResources.includes('Yes')) {
      console.log('')

      if (applyResources.includes('namespace')) {
        namespaceResources = await fs.readFile(`${projectPath}/namespace-resources.yaml`, 'utf8')
        nsResources = k8s.loadAllYaml(namespaceResources)
        await checkSpecsAndApply(nsResources)
      }

      const operatorFileString = await fs.readFile(`${projectPath}/entando-operator-config.yaml`, 'utf8')
      const operatorSpecs: k8s.KubernetesObject[] = k8s.loadAllYaml(operatorFileString)
      await checkSpecsAndApply(operatorSpecs)

      if (tls) {
        const tlsFileString = await fs.readFile(`${projectPath}/${projectName}-tls-cert.yaml`, 'utf8')
        const tlsSpecs: k8s.KubernetesObject[] = k8s.loadAllYaml(tlsFileString)
        await checkSpecsAndApply(tlsSpecs)
      }

      const entandoAppString = await fs.readFile(`${projectPath}/entando-${projectName}-app.yaml`, 'utf8')
      const entandoAppSpecs: k8s.KubernetesObject[] = k8s.loadAllYaml(entandoAppString)
      await checkSpecsAndApply(entandoAppSpecs)

      const postgresFileString = await fs.readFile(`${projectPath}/postgres-secret.yaml`, 'utf8')
      const postgresSpecs: k8s.KubernetesObjectApi[] = k8s.loadAllYaml(postgresFileString)
      await checkSpecsAndApply(postgresSpecs)

      console.log('\nAll done! The deployment should be under way!')
      console.log(`\nYou can check the created resources in '${projectPath}'.`)
    } else {
      console.log('\nUnderstood!')
      console.log(`\nYou can check the created resources in '${projectPath}' and execute:`)
      console.log(`\n  kubectl apply -f entando-${projectName}-app.yaml`)
      console.log('\nBe sure to edit and apply the other configuration files to your liking, if needed (e.g.: \'entando-operator-config.yaml\'.')
      console.log('\nExample:')
      console.log(`\n  kubectl apply -f entando-operator-config.yaml -n ${namespace}`)
    }

    console.log('\n------------------------------------------------------------------------------')
    console.log('\nIf you need to restart the deployment of Entando after an error, execute this:')
    console.log(`\n  kubectl patch enap ${projectName} --type merge --patch-file redeploy.yaml`)
    console.log('\n------------------------------------------------------------------------------')
    console.log('\n* REMINDER\n* Please, note that this program does not change your environment\'s Kubernetes configuration (e.g.: context, namespace).')
    console.log('* As such, you may need to run')
    console.log(`*\n*   kubectl config use-context ${currentContext}`)
    console.log('*\n* and/or')
    console.log(`*\n*   kubectl config set-context --current --namespace=${namespace}`)
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

          const patchTask = new Listr([
            {
              title: `Patching ${spec.metadata.name}`,
              task: async () => {
                await k8sObjApi.patch(spec).catch(() => {
                  throw new Error(`Error while patching ${spec.metadata.name}`)
                })
              },
            },
          ])

          await patchTask.run()
        } catch {
          const applyTask = new Listr([
            {
              title: `Creating ${spec.metadata.name}`,
              task: async () => {
                await k8sObjApi.create(spec).catch(() => {
                  throw new Error(`Error while creating ${spec.metadata.name}`)
                })
              },
            },
          ])

          await applyTask.run()
        }
      }
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
  }
}

function closeRun(run: Install) {
  console.log('\nExiting the program.\nHave a good rest of the day!\n')
  run.exit()
}
