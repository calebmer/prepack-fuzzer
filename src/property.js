const generate = require('@babel/generator').default;
const {gen, property} = require('testcheck');
const {executeNormal, executePrepack} = require('./execute');
const {genPrgramWrappedInIife} = require('./gen');
const {ReportStatus, reportTestFinish} = require('./report');

/**
 * Tests if the output of a Prepacked program is the same as the output of the
 * un-Prepacked program.
 */
const prepackWorks = property(
  genPrgramWrappedInIife.then(({args, program}) =>
    gen.return({
      args,
      code: generate(program).code,
    })
  ),
  ({args, code}) => {
    const start = Date.now();
    try {
      const expected = executeNormal(args, code);
      const actual = executePrepack(args, code);

      let ok = true;
      for (let i = 0; i < expected.length; i++) {
        const expectedResult = expected[i];
        const actualResult = actual[i];
        if (expectedResult.error) {
          if (!actualResult.error) {
            ok = false;
            break;
          }
        } else {
          if (expectedResult.value !== actualResult.value) {
            ok = false;
            break;
          }
        }
      }

      const end = Date.now();
      const time = end - start;
      reportTestFinish(time, ok ? ReportStatus.pass : ReportStatus.fail);

      return ok;
    } catch (error) {
      const end = Date.now();
      const time = end - start;

      if (error.message.includes('timed out')) {
        // Ignore programs which time out.
        reportTestFinish(time, ReportStatus.skip);
        return true;
      } else {
        reportTestFinish(time, ReportStatus.fail);
        return false;
      }
    }
  }
);

module.exports = {
  prepackWorks,
};
