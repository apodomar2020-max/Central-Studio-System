export * from './generated/api';
export * from './ballet';
export * from './balletCancellation';
export * from './permissions';
export * from './qr-attendance';

// Disambiguation (TS2308): these four names are now emitted by the generated
// OpenAPI Zod client *and* hand-written in ./qr-attendance. The hand-written
// versions are intentionally stricter than anything expressible in the spec
// (qrToken must be a UUID, bookingId/packageOrderId must be positive ints),
// and the backend relies on that strictness at the request boundary, so they
// stay authoritative. Explicit re-export resolves the ambiguity in their
// favour without weakening validation.
export {
  CheckInQrBody,
  CheckInQrResponse,
  ListCreditTransactionsQueryParams,
  ListCreditTransactionsResponse,
} from './qr-attendance';
