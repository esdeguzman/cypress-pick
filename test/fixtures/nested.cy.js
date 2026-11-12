// Scanned and also executed by test/pipeline.test.js, so it uses nothing a real
// spec would have, such as cy. The two halves of the package have to agree about
// this one file, which is the point of the test.
describe('Root', () => {
    it('loose test', () => {})

    context('A', () => {
        it('a1', () => {})

        context('A child', () => {
            it('a2', () => {})
        })
    })

    context('B', () => {
        it('b1', () => {})
    })
})
