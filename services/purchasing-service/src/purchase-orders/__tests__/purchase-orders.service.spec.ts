import { assertReceiveIncrementsValid } from '../receiveGoodsValidate'

describe('receive goods validation', () => {
  const lines = [
    {
      id: 'l1',
      lineNo: 1,
      qtyOrdered: 10,
      qtyReceived: 0,
    },
  ]

  it('rejects receive when qty would exceed ordered', () => {
    expect(() =>
      assertReceiveIncrementsValid(lines, [{ lineId: 'l1', qtyReceived: 11 }]),
    ).toThrow(/exceed/)
  })
})
