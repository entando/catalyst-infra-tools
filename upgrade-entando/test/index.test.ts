import {test} from '@oclif/test'

describe('Missing flag values', () => {
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
})
