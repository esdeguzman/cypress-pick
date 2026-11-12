// The shape that produced finding C1: a spec that can be narrowed and also carries
// only on one of its contexts.
describe('Confirmed bugs', () => {
    context('G. Sprint 3 guard', () => {
        it('g1', () => {})
    })

    context.only('Sprint 4', () => {
        it('s1', () => {})
        it('s2', () => {})
    })
})
