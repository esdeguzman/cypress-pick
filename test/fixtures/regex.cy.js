describe('Regex traps', () => {
    context('Apostrophe inside a regex', () => {
        it('does not let the apostrophe open a string', () => {
            cy.contains(/Don't panic/)
        })
    })

    context('Unmatched brace inside a regex', () => {
        it('does not let the brace close the suite early', () => {
            cy.get('input').invoke('val').should('match', /[^}]/)
        })
    })

    context('Division is not a regex', () => {
        it('still reads this test after a division expression', () => {
            const half = count / 2
        })
    })
})
