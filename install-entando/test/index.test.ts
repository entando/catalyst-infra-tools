import {test} from '@oclif/test'

describe('Missing flag values', () => {
  test
  .stdout()
  .command(['.', '-h'])
  .catch('Flag --hostname expects a value')
  .it('Error when setting the hostname flag with no value')

  test
  .stdout()
  .command(['.', '-v'])
  .catch('Flag --entandoversion expects a value')
  .it('Error when setting the version flag with no value')

  test
  .stdout()
  .command(['.', '-n'])
  .catch('Flag --namespace expects a value')
  .it('Error when setting the namespace flag with no value')

  test
  .stdout()
  .command(['.', '-p'])
  .catch('Flag --project expects a value')
  .it('Error when setting the project flag with no value')
})
