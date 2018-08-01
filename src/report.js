const chalk = require('chalk');
const prettyMs = require('pretty-ms');

const ReportStatus = {
  pass: 'pass',
  fail: 'fail',
  timeout: 'timeout',
};

const statusIcon = {
  pass: chalk.green('✔'),
  fail: chalk.red('✘'),
  timeout: chalk.yellow('!'),
};

const statusVerb = {
  pass: 'passed',
  fail: 'failed',
  timeout: 'timed out',
};

function reportTestFinish(time, size, status) {
  const icon = statusIcon[status];
  const verb = statusVerb[status];
  console.log(`${icon} Test of size ${size} ${verb} in ${prettyMs(time)}`);
}

function reportDivider(error = false) {
  const divider = chalk.dim('┈'.repeat(process.stdout.columns));
  if (error) {
    console.error(divider);
  } else {
    console.log(divider);
  }
}

module.exports = {
  ReportStatus,
  passIcon: statusIcon.pass,
  failIcon: statusIcon.fail,
  reportTestFinish,
  reportDivider,
};
