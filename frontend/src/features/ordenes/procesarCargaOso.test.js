import { procesarCargaOso } from './ordenesOso';

describe('procesarCargaOso', () => {
  test('sin datos devuelve todo vacío', () => {
    expect(procesarCargaOso({}, null)).toEqual({ orders: [], boMeta: {}, faltantes: [] });
    expect(procesarCargaOso({ orders: [] }, [])).toEqual({ orders: [], boMeta: {}, faltantes: [] });
  });

  test('mapea la meta campo por campo desde snake_case', () => {
    const { boMeta } = procesarCargaOso({ orders: [{ bo: 'BO1' }] }, [{
      bo: 'BO1',
      project_name: 'Proyecto',
      po_axis: 'PO-1',
      estimated_invoice_date: '2026-09-15',
      estimated_invoice_month: '2026-09',
      estimated_invoice_week: '2',
      s_and_d_status: 'aplicado',
      invoiced: true,
      invoiced_at: '2026-09-20',
      customer_name: 'Alfa',
      alloc_pct: 40,
      customer_po: 'CPO',
      last_seen_at: '2026-09-01',
      purchase_status: 'ok',
      purchase_dispatch: 'aereo',
      purchase_shipping: 'dhl',
      purchase_so: 'SO-1',
      deleted: false,
      deleted_at: '',
      deleted_comment: '',
      deleted_by: null
    }]);
    expect(boMeta.BO1).toEqual({
      projectName: 'Proyecto',
      poAxis: 'PO-1',
      estimatedInvoiceDate: '2026-09-15',
      estimatedInvoiceMonth: '2026-09',
      estimatedInvoiceWeek: '2',
      sAndDStatus: 'aplicado',
      invoiced: true,
      invoicedAt: '2026-09-20',
      customerName: 'Alfa',
      allocPct: 40,
      customerPO: 'CPO',
      lastSeenAt: '2026-09-01',
      purchaseStatus: 'ok',
      purchaseDispatch: 'aereo',
      purchaseShipping: 'dhl',
      purchaseSo: 'SO-1',
      deleted: false,
      deletedAt: '',
      deletedComment: '',
      deletedBy: null
    });
  });

  test('acepta camelCase, normaliza mes y semana y pone valores por defecto', () => {
    const { boMeta } = procesarCargaOso({ orders: [] }, [
      { bo: 'A', estimatedInvoiceDate: '2026-03-10', estimatedInvoiceWeek: 9 },
      { bo: 'B', estimatedInvoiceMonth: '2026-04', estimatedInvoiceWeek: 3 },
      { projectName: 'sin bo' }
    ]);
    expect(Object.keys(boMeta)).toEqual(['A', 'B']);
    expect(boMeta.A.estimatedInvoiceMonth).toBe('2026-03');
    expect(boMeta.A.estimatedInvoiceWeek).toBe('');
    expect(boMeta.B.estimatedInvoiceMonth).toBe('2026-04');
    expect(boMeta.B.estimatedInvoiceWeek).toBe('3');
    expect(boMeta.A.invoiced).toBe(false);
    expect(boMeta.A.deleted).toBe(false);
    expect(boMeta.A.deletedBy).toBeNull();
    expect(boMeta.A.allocPct).toBeUndefined();
  });

  test('faltantes: meta sin orden en OSO, ni facturada ni eliminada', () => {
    const { orders, faltantes } = procesarCargaOso({ orders: [{ bo: 'EN_OSO' }] }, [
      { bo: 'EN_OSO' },
      { bo: 'FALTA' },
      { bo: 'FACTURADA', invoiced: true },
      { bo: 'ELIMINADA', deleted: true }
    ]);
    expect(orders).toEqual([{ bo: 'EN_OSO' }]);
    expect(faltantes).toEqual(['FALTA']);
  });
});
