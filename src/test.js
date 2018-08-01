const chalk = require('chalk');
const {check} = require('testcheck');
const {prepackWorks} = require('./property');
const {passIcon, failIcon, reportDivider} = require('./report');

const test = check(prepackWorks, {numTests: 1000, maxSize: 200});
const {seed, numTests} = test;
const plural = numTests === 1 ? '' : 's';

reportDivider();
if (test.result === true) {
  console.log(
    `${passIcon} Passed after running ${numTests} test${plural} ` +
      `with seed ${seed}`
  );
} else {
  console.error(
    `${failIcon} Failed after running ${numTests} test${plural} ` +
      `with seed ${seed}`
  );
  if (test.result !== false) {
    console.error(chalk.red(test.result.stack));
  }
  test.shrunk.smallest.forEach((code, i) => {
    reportDivider(true);
    console.error(code);
  });
  reportDivider(true);
}
