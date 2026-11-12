// The shape that produced finding C2. The outer title is built while the file runs,
// so the picker cannot name it on the command line, and nothing inside it can be
// named either.
const n = 1

describe('Root', () => {
    context('Row ' + n, () => {
        context('valid values', () => {
            it('v1', () => {})
        })
    })

    context('Plain', () => {
        it('p1', () => {})
    })
})
