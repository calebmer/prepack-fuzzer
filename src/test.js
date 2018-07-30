const {check} = require('testcheck');
const {prepackWorks} = require('./property');
const {passIcon, failIcon, reportDivider} = require('./report');

const test = check(prepackWorks, {numTests: 1000, maxSize: 200});
const {numTests} = test;
const plural = numTests === 1 ? '' : 's';

reportDivider();
if (test.result === true) {
  console.log(`${passIcon} Passed after running ${numTests} test${plural}`);
} else {
  console.error(`${failIcon} Failed after running ${numTests} test${plural}`);
  if (test.result !== false) {
    console.error(chalk.red(test.result.stack));
    console.error();
  }
  test.fail.forEach((fail, i) => {
    reportDivider(true);
    console.error(fail);
  });
  reportDivider(true);
}
