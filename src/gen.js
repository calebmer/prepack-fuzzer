const t = require('@babel/types');
const {gen} = require('testcheck');

const genStringLiteral = gen
  .array(gen.asciiChar, {maxSize: 20})
  .then(chars => gen.return(t.stringLiteral(chars.join(''))));

function genComputation() {
  function getInitialState() {
    return {
      declarations: [],
      scopes: [getInitialScope()],
      nextVariableId: 1,
      nextFunctionId: 1,
      arguments: null,
    };
  }

  function getInitialScope() {
    return {
      variables: [],
      functions: [],
    };
  }

  let state = null;

  function newVariable() {
    const name = `x${state.nextVariableId++}`;
    state.scopes[state.scopes.length - 1].variables.push({name});
    return name;
  }

  function newFunction(arity) {
    const name = `f${state.nextFunctionId++}`;
    state.scopes[state.scopes.length - 1].functions.push({name, arity});
    return name;
  }

  function newArgument() {
    if (state.arguments === null) {
      return null;
    } else {
      const name = `a${state.arguments++ + 1}`;
      state.scopes[state.scopes.length - 1].variables.push({name});
      return name;
    }
  }

  const genScalarComputationWeightedCases = [
    // null / undefined
    [
      5,
      {
        statements: [],
        expression: gen.oneOf([
          gen.return(t.nullLiteral()),
          gen.return(t.identifier('undefined')),
        ]),
      },
    ],

    // number
    [
      1,
      {
        statements: [],
        expression: gen.number.then(n => gen.return(t.numericLiteral(n))),
      },
    ],

    // string
    [
      1,
      {
        statements: [],
        expression: genStringLiteral,
      },
    ],

    // boolean
    [
      10,
      {
        statements: [],
        expression: gen.boolean.then(b => t.booleanLiteral(b)),
      },
    ],
  ];

  const genScalarComputation = gen.oneOfWeighted([
    ...genScalarComputationWeightedCases,

    // Reuse variable
    [
      5,
      gen.null.then(() => {
        let variables = [];
        // Reuse the variables array if we only have one. Otherwise add all scope
        // variables to our local variables array.
        if (state.scopes.length === 1) {
          variables = state.scopes[0].variables;
        } else {
          for (let i = 0; i < state.scopes.length; i++) {
            const scope = state.scopes[i];
            for (let k = 0; k < scope.variables.length; k++) {
              variables.push(gen.return(scope.variables[k]));
            }
          }
        }
        if (variables.length === 0) {
          return gen.oneOfWeighted(genScalarComputationWeightedCases);
        } else {
          return gen.oneOf(variables).then(v =>
            gen.return({
              statements: [],
              expression: t.identifier(v.name),
            })
          );
        }
      }),
    ],

    // Function argument
    [
      20,
      gen.null.then(() => {
        const argument = newArgument();
        if (argument === null) {
          return gen.oneOfWeighted(genScalarComputationWeightedCases);
        } else {
          return gen.return({
            statements: [],
            expression: t.identifier(argument),
          });
        }
      }),
    ],
  ]);

  const genComputation = gen.nested(genComputation => {
    // Hack in scope tracking by pushing/popping state.
    const genConditionalComputation = gen.null
      .then(() => {
        state.scopes.push(getInitialScope());
        return genComputation;
      })
      .then(computation => {
        state.scopes.pop();
        return gen.return(computation);
      });

    return gen.oneOfWeighted([
      // condition ? consequent : alternate
      [
        5,
        gen({
          condition: genComputation,
          consequent: genConditionalComputation,
          alternate: genConditionalComputation,
        }).then(({condition, consequent, alternate}) => {
          // If our consequent and/or alternate have statements then we need to
          // hoist these statements to an if-statement.
          const conditionReuse =
            (consequent.statements.length !== 0 ||
              alternate.statements.length !== 0) &&
            t.identifier(newVariable());
          if (conditionReuse) {
            condition.statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(conditionReuse, condition.expression),
              ])
            );
            if (
              consequent.statements.length === 0 &&
              alternate.statements.length !== 0
            ) {
              condition.statements.push(
                t.ifStatement(
                  t.unaryExpression('!', conditionReuse),
                  t.blockStatement(alternate.statements)
                )
              );
            } else {
              condition.statements.push(
                t.ifStatement(
                  conditionReuse,
                  t.blockStatement(consequent.statements),
                  alternate.statements.length === 0
                    ? undefined
                    : t.blockStatement(alternate.statements)
                )
              );
            }
          }
          return gen.return({
            statements: condition.statements,
            expression: t.conditionalExpression(
              conditionReuse || condition.expression,
              consequent.expression,
              alternate.expression
            ),
          });
        }),
      ],

      // if (condition) { consequent } else { alternate }
      [
        10,
        gen({
          condition: genComputation,
          consequent: genConditionalComputation,
          alternate: genConditionalComputation,
          returnConsequent: gen.oneOfWeighted([
            [1, gen.return(true)],
            [3, gen.return(false)],
          ]),
          returnAlternate: gen.oneOfWeighted([
            [1, gen.return(true)],
            [3, gen.return(false)],
          ]),
        }).then(
          ({
            condition,
            consequent,
            alternate,
            returnConsequent,
            returnAlternate,
          }) => {
            const variable = newVariable();

            condition.statements.push(
              t.variableDeclaration('var', [
                t.variableDeclarator(t.identifier(variable)),
              ])
            );
            if (returnConsequent) {
              consequent.statements.push(
                t.returnStatement(consequent.expression)
              );
            } else {
              consequent.statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(variable),
                    consequent.expression
                  )
                )
              );
            }
            if (returnAlternate) {
              alternate.statements.push(
                t.returnStatement(alternate.expression)
              );
            } else {
              alternate.statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.identifier(variable),
                    alternate.expression
                  )
                )
              );
            }
            condition.statements.push(
              t.ifStatement(
                condition.expression,
                t.blockStatement(consequent.statements),
                t.blockStatement(alternate.statements)
              )
            );

            return gen.return({
              statements: condition.statements,
              expression: t.identifier(variable),
            });
          }
        ),
      ],

      // var id = init;
      [
        20,
        genComputation.then(({statements, expression}) => {
          const variable = newVariable();
          statements.push(
            t.variableDeclaration('var', [
              t.variableDeclarator(t.identifier(variable), expression),
            ])
          );
          return gen.return({
            statements,
            expression: t.identifier(variable),
          });
        }),
      ],

      // function f(...args) { body }
      [
        15,
        gen.null.then(() => {
          // Save old stuff
          const prevArguments = state.arguments;
          const prevScopes = state.scopes;

          // Set new stuff
          state.arguments = 0;
          state.scopes = [getInitialScope()];

          return genComputation
            .then(computation => {
              // Save new stuff
              const argumentsCount = state.arguments;

              // Restore old stuff
              state.arguments = prevArguments;
              state.scopes = prevScopes;

              // Generate arguments in old scope.
              return {
                computation: gen.return(computation),
                args: Array(argumentsCount).fill(genComputation),
              };
            })
            .then(({computation, args}) => {
              computation.statements.push(
                t.returnStatement(computation.expression)
              );
              const name = newFunction(args.length);
              const declaration = t.functionDeclaration(
                t.identifier(name),
                args.map((c, i) => t.identifier(`a${i + 1}`)),
                t.blockStatement(computation.statements)
              );
              state.declarations.push(declaration);

              const statements = args[0] ? args[0].statements : [];
              pushAll(statements, ...args.slice(1).map(c => c.statements));
              return gen.return({
                statements,
                expression: t.callExpression(
                  t.identifier(name),
                  args.map(c => c.expression)
                ),
              });
            });
        }),
      ],

      // f(...args)
      [
        5,
        gen.null.then(() => {
          let functions = [];
          // Reuse the functions array if we only have one. Otherwise add all
          // scope functions to our local functions array.
          if (state.scopes.length === 1) {
            functions = state.scopes[0].functions;
          } else {
            for (let i = 0; i < state.scopes.length; i++) {
              const scope = state.scopes[i];
              for (let k = 0; k < scope.functions.length; k++) {
                functions.push(gen.return(scope.functions[k]));
              }
            }
          }
          if (functions.length === 0) {
            // If we have no functions then gen a computation.
            return genComputation;
          } else {
            return gen
              .oneOf(functions)
              .then(f => {
                const args = Array(f.arity);
                args.fill(genComputation);
                return [gen.return(f), args];
              })
              .then(([f, args]) => {
                const statements = args[0] ? args[0].statements : [];
                pushAll(statements, ...args.slice(1).map(c => c.statements));
                return gen.return({
                  statements,
                  expression: t.callExpression(
                    t.identifier(f.name),
                    args.map(c => c.expression)
                  ),
                });
              });
          }
        }),
      ],

      // ignored; computation
      [
        1,
        gen([genComputation, genComputation]).then(([ignored, computation]) => {
          const {statements} = ignored;
          statements.push(t.expressionStatement(ignored.expression));
          pushAll(statements, computation.statements);
          return gen.return({
            statements,
            expression: computation.expression,
          });
        }),
      ],
    ]);
  }, genScalarComputation);

  // Hack in some state that resets for each test case since the API does not
  // explicitly provide us this. Depends on entire test cases being
  // generated synchronously.
  return gen.null
    .then(() => {
      state = getInitialState();
      return genComputation;
    })
    .then(computation => {
      const {declarations} = state;
      state = null;
      return gen.return({declarations, computation});
    });
}

function pushAll(target, ...sources) {
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    for (let k = 0; k < source.length; k++) {
      target.push(source[k]);
    }
  }
}

const genProgramStatements = genComputation().then(
  ({declarations, computation}) => {
    computation.statements.push(t.returnStatement(computation.expression));
    const statements = [];
    declarations.forEach(declaration => {
      statements.push(declaration);
    });
    statements.push(
      t.functionDeclaration(
        t.identifier('main'),
        [],
        t.blockStatement(computation.statements)
      )
    );
    statements.push(
      t.ifStatement(
        t.memberExpression(t.identifier('global'), t.identifier('__optimize')),
        t.expressionStatement(
          t.callExpression(t.identifier('__optimize'), [t.identifier('main')])
        )
      )
    );
    statements.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(t.identifier('module'), t.identifier('exports')),
          t.identifier('main')
        )
      )
    );
    return gen.return(statements);
  }
);

const genProgram = genProgramStatements.then(statements =>
  gen.return(t.program(statements))
);

const genPrgramWrappedInIife = genProgramStatements.then(statements =>
  gen.return(
    t.program([
      t.expressionStatement(
        t.callExpression(
          t.functionExpression(null, [], t.blockStatement(statements)),
          []
        )
      ),
    ])
  )
);

module.exports = {
  genProgram,
  genPrgramWrappedInIife,
};
