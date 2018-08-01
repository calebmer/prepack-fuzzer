const util = require('util');
const chalk = require('chalk');
const {check} = require('testcheck');
const {executeNormal, executePrepack} = require('./execute');
const {prepackWorks} = require('./property');
const {passIcon, failIcon, divider} = require('./report');

console.log(divider);
const test = check(prepackWorks, {numTests: 1000, maxSize: 200});
console.log(divider);

const {seed, numTests} = test;
const plural = numTests === 1 ? '' : 's';

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
  test.shrunk.smallest.forEach(({args, code}, i) => {
    console.error(divider);
    console.error(code);
    console.error(divider);
    const expected = executeNormal(args, code);
    const actual = executePrepack(args, code);
    args.forEach((args, i) => {
      if (i !== 0) {
        console.error();
      }
      console.error(`${chalk.dim('Arguments:')} ${inspect(args)}`);
      console.error(` ${chalk.dim('Expected:')} ${inspect(expected[i].value)}`);
      console.error(`   ${chalk.dim('Actual:')} ${inspect(actual[i].value)}`);
    });
  });
  console.error(divider);
}

function inspect(value) {
  return util.inspect(value, {colors: true});
}
