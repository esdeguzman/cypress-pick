// A comment that mentions context('Not real') and it('also not real').
/*
   A block comment with describe('Still not real') inside it.
*/
const NAME = 'built from a variable'

describe('Root', { expose: { skipLogin: true } }, () => {
    // A string containing the word context('fake') must not count.
    const note = "context('fake')"

    context('Quoted "double" and \'single\'', () => {
        it('has a title with quotes', () => {})
    })

    context(`template ${NAME}`, () => {
        it('cannot have its title read', () => {})
    })

    context.only('Only this one', () => {
        it('runs', () => {})
        it.skip('does not run', () => {})
    })

    specify('specify counts as a test', () => {})
})
