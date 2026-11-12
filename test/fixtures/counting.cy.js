// Finding I2: what the header and the warning lines are allowed to count. Two of
// these four tests run. The other two are skipped, one by its own skip and one by
// the skip on the context around it.
describe('Root', () => {
    it('runs', () => {})

    it.skip('does not run', () => {})

    context.skip('all skipped', () => {
        it('also does not run', () => {})
    })

    it.only('only this one', () => {})
})
