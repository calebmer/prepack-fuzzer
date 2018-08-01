const t = require('@babel/types');
const Immutable = require('immutable');
const {gen} = require('testcheck');

const ScopeRecord = Immutable.Record({
  variables: Immutable.List([]),
  functions: Immutable.List([]),
});

const StateRecord = Immutable.Record({
  declarations: Immutable.List(),
  scopes: Immutable.List([ScopeRecord()]),
  nextVariableId: 1,
  nextFunctionId: 1,
  arguments: null,
});

const genStringLiteral = gen
  .array(gen.asciiChar, {maxSize: 20})
  .then(chars => gen.return(t.stringLiteral(chars.join(''))));

function genComputation() {
  const _getStateSymbol = Symbol('getState');

  function* getState() {
    return yield _getStateSymbol;
  }

  function* putState(nextState) {
    yield nextState;
  }

  function* replaceState(f) {
    yield f(yield _getStateSymbol);
  }

  function* newVariable() {
    let state = yield* getState();
    const name = `x${state.nextVariableId}`;
    state = state
      .update('nextVariableId', x => x + 1)
      .updateIn(['scopes', -1, 'variables'], vs => vs.push({name}));
    yield* putState(state);
    return name;
  }

  function* newFunction(arity) {
    let state = yield* getState();
    const name = `f${state.nextFunctionId}`;
    state = state
      .update('nextFunctionId', x => x + 1)
      .updateIn(['scopes', -1, 'functions'], fs => fs.push({name, arity}));
    yield* putState(state);
    return name;
  }

  function* newArgument() {
    let state = yield* getState();
    if (state.arguments === null) {
      return null;
    } else {
      const name = `a${state.arguments}`;
      state = state
        .update('arguments', x => x + 1)
        .updateIn(['scopes', -1, 'variables'], vs => vs.push({name}));
      yield* putState(state);
      return name;
    }
  }

  const genScalarExpressionWeightedCases = [
    // null / undefined
    [
      5,
      gen.oneOf([
        gen.return(t.nullLiteral()),
        gen.return(t.identifier('undefined')),
      ]),
    ],

    // number
    [1, gen.number.then(n => gen.return(t.numericLiteral(n)))],

    // string
    [1, genStringLiteral],

    // boolean
    [10, gen.boolean.then(b => t.booleanLiteral(b))],

    // // Intentional failure. Uncomment this to test if everything is working.
    // [
    //   1,
    //   gen.return(
    //     t.conditionalExpression(
    //       t.memberExpression(
    //         t.identifier('global'),
    //         t.identifier('__optimize')
    //       ),
    //       t.booleanLiteral(true),
    //       t.booleanLiteral(false)
    //     )
    //   ),
    // ],
  ];

  const genScalarExpression = gen.oneOfWeighted([
    ...genScalarExpressionWeightedCases,

    // // Reuse variable
    // [
    //   5,
    //   gen.null.then(() => {
    //     let variables = [];
    //     // Reuse the variables array if we only have one. Otherwise add all scope
    //     // variables to our local variables array.
    //     if (state.scopes.length === 1) {
    //       variables = state.scopes[0].variables;
    //     } else {
    //       for (let i = 0; i < state.scopes.length; i++) {
    //         const scope = state.scopes[i];
    //         for (let k = 0; k < scope.variables.length; k++) {
    //           variables.push(gen.return(scope.variables[k]));
    //         }
    //       }
    //     }
    //     if (variables.length === 0) {
    //       return gen.oneOfWeighted(genScalarExpressionWeightedCases);
    //     } else {
    //       return gen
    //         .oneOf(variables)
    //         .then(v => gen.return(t.identifier(v.name)));
    //     }
    //   }),
    // ],

    // // Function argument
    // [
    //   20,
    //   gen.null.then(() => {
    //     const argument = newArgument();
    //     if (argument === null) {
    //       return gen.oneOfWeighted(genScalarExpressionWeightedCases);
    //     } else {
    //       return gen.return(t.identifier(argument));
    //     }
    //   }),
    // ],
  ]);

  const genScalarComputation = genScalarExpression.then(
    expression =>
      function*() {
        return {
          statements: Immutable.List(),
          expression,
        };
      }
  );

  function* conditional(computation) {
    yield* replaceState(state =>
      state.update('scopes', scopes => scopes.push(ScopeRecord()))
    );
    const result = yield* computation();
    yield* replaceState(state => state.update('scopes', scope => scope.pop()));
    return result;
  }

  const genComputation = gen.nested(
    genComputation =>
      gen.oneOfWeighted([
        // condition ? consequent : alternate
        [
          5,
          gen({
            conditionComputation: genComputation,
            consequentComputation: genComputation,
            alternateComputation: genComputation,
          }).then(
            ({
              conditionComputation,
              consequentComputation,
              alternateComputation,
            }) =>
              function*() {
                const condition = yield* conditionComputation();
                let statements = condition.statements;

                // Conditionally generate consequent and alternate.
                const consequent = yield* conditional(consequentComputation);
                const alternate = yield* conditional(alternateComputation);

                // If our consequent and/or alternate have statements then we need to
                // hoist these statements to an if-statement.
                const conditionReuse =
                  (!consequent.statements.isEmpty() ||
                    !alternate.statements.isEmpty()) &&
                  t.identifier(yield* newVariable());

                if (conditionReuse) {
                  statements = statements.push(
                    t.variableDeclaration('var', [
                      t.variableDeclarator(
                        conditionReuse,
                        condition.expression
                      ),
                    ])
                  );
                  if (
                    consequent.statements.isEmpty() &&
                    !alternate.statements.isEmpty()
                  ) {
                    statements = statements.push(
                      t.ifStatement(
                        t.unaryExpression('!', conditionReuse),
                        t.blockStatement(alternate.statements.toArray())
                      )
                    );
                  } else {
                    statements = statements.push(
                      t.ifStatement(
                        conditionReuse,
                        t.blockStatement(consequent.statements.toArray()),
                        alternate.statements.size === 0
                          ? undefined
                          : t.blockStatement(alternate.statements.toArray())
                      )
                    );
                  }
                }
                return {
                  statements,
                  expression: t.conditionalExpression(
                    conditionReuse || condition.expression,
                    consequent.expression,
                    alternate.expression
                  ),
                };
              }
          ),
        ],

        // if (condition) { consequent } else { alternate }
        [
          10,
          gen({
            conditionComputation: genComputation,
            consequentComputation: genComputation,
            alternateComputation: genComputation,
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
              conditionComputation,
              consequentComputation,
              alternateComputation,
              returnConsequent,
              returnAlternate,
            }) =>
              function*() {
                const condition = yield* conditionComputation();
                const variable = yield* newVariable();
                const consequent = yield* conditional(consequentComputation);
                const alternate = yield* conditional(alternateComputation);

                let {statements} = condition;
                let consequentStatements = consequent.statements;
                let alternateStatements = alternate.statements;

                statements = statements.push(
                  t.variableDeclaration('var', [
                    t.variableDeclarator(t.identifier(variable)),
                  ])
                );

                if (returnConsequent) {
                  consequentStatements = consequentStatements.push(
                    t.returnStatement(consequent.expression)
                  );
                } else {
                  consequentStatements = consequentStatements.push(
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
                  alternateStatements = alternateStatements.push(
                    t.returnStatement(alternate.expression)
                  );
                } else {
                  alternateStatements = alternateStatements.push(
                    t.expressionStatement(
                      t.assignmentExpression(
                        '=',
                        t.identifier(variable),
                        alternate.expression
                      )
                    )
                  );
                }
                statements = statements.push(
                  t.ifStatement(
                    condition.expression,
                    t.blockStatement(consequentStatements.toArray()),
                    t.blockStatement(alternateStatements.toArray())
                  )
                );

                return {
                  statements,
                  expression: t.identifier(variable),
                };
              }
          ),
        ],

        // var id = init;
        [
          20,
          genComputation.then(
            computation =>
              function*() {
                const {statements, expression} = yield* computation();
                const variable = yield* newVariable();
                return {
                  statements: statements.push(
                    t.variableDeclaration('var', [
                      t.variableDeclarator(t.identifier(variable), expression),
                    ])
                  ),
                  expression: t.identifier(variable),
                };
              }
          ),
        ],

        // // function f(...args) { body }
        // [
        //   15,
        //   gen.null.then(() => {
        //     // Save old stuff
        //     const prevArguments = state.arguments;
        //     const prevScopes = state.scopes;

        //     // Set new stuff
        //     state.arguments = 0;
        //     state.scopes = [getInitialScope()];

        //     return genComputation
        //       .then(computation => {
        //         // Save new stuff
        //         const argumentsCount = state.arguments;

        //         // Restore old stuff
        //         state.arguments = prevArguments;
        //         state.scopes = prevScopes;

        //         // Generate arguments in old scope.
        //         return {
        //           computation: gen.return(computation),
        //           args: Array(argumentsCount).fill(genComputation),
        //         };
        //       })
        //       .then(
        //         ({
        //           computation: {
        //             statements: functionStatements,
        //             expression: functionExpression,
        //           },
        //           args,
        //         }) => {
        //           functionStatements = functionStatements.push(
        //             t.returnStatement(functionExpression)
        //           );
        //           const name = newFunction(args.length);
        //           const declaration = t.functionDeclaration(
        //             t.identifier(name),
        //             args.map((c, i) => t.identifier(`a${i + 1}`)),
        //             t.blockStatement(functionStatements.toArray())
        //           );
        //           state.declarations.push(declaration);

        //           const statements = Immutable.List().concat(
        //             ...args.map(c => c.statements)
        //           );
        //           return gen.return({
        //             statements,
        //             expression: t.callExpression(
        //               t.identifier(name),
        //               args.map(c => c.expression)
        //             ),
        //           });
        //         }
        //       );
        //   }),
        // ],

        // // f(...args)
        // [
        //   5,
        //   gen.null.then(() => {
        //     let functions = [];
        //     // Reuse the functions array if we only have one. Otherwise add all
        //     // scope functions to our local functions array.
        //     if (state.scopes.length === 1) {
        //       functions = state.scopes[0].functions;
        //     } else {
        //       for (let i = 0; i < state.scopes.length; i++) {
        //         const scope = state.scopes[i];
        //         for (let k = 0; k < scope.functions.length; k++) {
        //           functions.push(gen.return(scope.functions[k]));
        //         }
        //       }
        //     }
        //     if (functions.length === 0) {
        //       // If we have no functions then gen a computation.
        //       return genComputation;
        //     } else {
        //       return gen
        //         .oneOf(functions)
        //         .then(f => {
        //           const args = Array(f.arity);
        //           args.fill(genComputation);
        //           return [gen.return(f), args];
        //         })
        //         .then(([f, args]) => {
        //           const statements = Immutable.List().concat(
        //             ...args.map(c => c.statements)
        //           );
        //           return gen.return({
        //             statements,
        //             expression: t.callExpression(
        //               t.identifier(f.name),
        //               args.map(c => c.expression)
        //             ),
        //           });
        //         });
        //     }
        //   }),
        // ],

        // ignored; computation
        [
          1,
          gen([genComputation, genComputation]).then(
            ([ignoredComputation, computation]) =>
              function*() {
                const {
                  statements: ignoredStatements,
                  expression: ignoredExpression,
                } = yield* ignoredComputation();
                const {statements, expression} = yield* computation();
                return {
                  statements: ignoredStatements
                    .push(t.expressionStatement(ignoredExpression))
                    .concat(statements),
                  expression,
                };
              }
          ),
        ],
      ]),
    genScalarComputation
  );

  // Runer for the state monad we use for computations. We want to use some
  // state in our computations. This is why we use a monad.
  return genComputation.then(computation => {
    const generator = computation();
    let state = StateRecord();
    let step = generator.next();
    while (!step.done) {
      if (step.value === _getStateSymbol) {
        step = generator.next(state);
      } else {
        state = step.value;
        step = generator.next();
      }
    }
    return {
      declarations: state.declarations,
      computation: step.value,
    };
  });
}

const genProgramStatements = genComputation().then(
  ({
    declarations,
    computation: {statements: mainStatements, expression: mainExpression},
  }) => {
    mainStatements = mainStatements.push(t.returnStatement(mainExpression));
    const statements = [];
    statements.push(t.expressionStatement(t.stringLiteral('use strict')));
    declarations.forEach(declaration => {
      statements.push(declaration);
    });
    statements.push(
      t.functionDeclaration(
        t.identifier('main'),
        [],
        t.blockStatement(mainStatements.toArray())
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
