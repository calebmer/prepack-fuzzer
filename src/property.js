const vm = require('vm');
const generate = require('@babel/generator').default;
const {gen, property} = require('testcheck');
const {prepackSources} = require('/Users/calebmer/prepack/lib/prepack-node.js');
const {genPrgramWrappedInIife} = require('./gen');
const {ReportStatus, reportTestFinish} = require('./report');

let size;

/**
 * Tests if the output of a Prepacked program is the same as the output of the
 * un-Prepacked program.
 */
const prepackWorks = property(
  gen.sized(genSize => {
    size = genSize;
    return genPrgramWrappedInIife.then(program => generate(program).code);
  }),
  code => {
    const start = Date.now();
    try {
      let expected;
      let expectedError;
      {
        const context = createVmContext();
        vm.runInContext(code, context);
        try {
          expected = context.module.exports();
        } catch (error) {
          expectedError = error;
        }
      }

      let actual;
      let actualError;
      {
        const prepackedCode = prepackSources(
          [{fileContents: code, filePath: 'test.js'}],
          prepackOptions
        ).code;
        const context = createVmContext();
        vm.runInContext(prepackedCode, context);
        try {
          actual = context.module.exports();
        } catch (error) {
          actualError = error;
        }
      }

      const ok = expectedError
        ? !!expectedError && !!actualError
        : expected === actual;

      const end = Date.now();
      const time = end - start;
      reportTestFinish(time, size, ok ? ReportStatus.pass : ReportStatus.fail);

      return ok;
    } catch (error) {
      const end = Date.now();
      const time = end - start;

      if (error.message.includes('timed out')) {
        // Ignore programs which time out.
        reportTestFinish(time, size, ReportStatus.timeout);
        return true;
      } else {
        reportTestFinish(time, size, ReportStatus.fail);
        return false;
      }
    }
  }
);

function createVmContext() {
  const sandbox = {
    module: {exports: {}},
  };
  sandbox.global = sandbox;
  return vm.createContext(sandbox);
}

const prepackOptions = {
  errorHandler: diag => {
    if (diag.severity === 'Information') return 'Recover';
    if (diag.errorCode === 'PP0025') return 'Recover';
    if (diag.severity !== 'Warning') return 'Fail';
    return 'Recover';
  },
  compatibility: 'fb-www',
  internalDebug: true,
  serialize: true,
  uniqueSuffix: '',
  maxStackDepth: 100,
  instantRender: false,
  reactEnabled: true,
  reactOutput: 'create-element',
  reactVerbose: true,
  reactOptimizeNestedFunctions: false,
  inlineExpressions: true,
  invariantLevel: 0,
  abstractValueImpliesMax: 1000,
};

module.exports = {
  prepackWorks,
};
