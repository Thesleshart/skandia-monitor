/**
 * Variación porcentual entre dos valores.
 * Retorna null si no hay base válida (evita división por cero).
 */
function calcVariacion(actual, anterior) {
  if (anterior == null || anterior === 0 || actual == null) return null;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

/**
 * Calcula variaciones diaria, mensual y anual para un registro.
 * @param {Object} hoy  - registro del día actual
 * @param {Object} refs - { yesterday, firstOfMonth, firstOfYear }
 */
function getVariaciones(hoy, { yesterday, firstOfMonth, firstOfYear } = {}) {
  if (!hoy) return null;
  const t = hoy.total;
  return {
    diaria:  yesterday    ? calcVariacion(t, yesterday.total)    : null,
    mensual: firstOfMonth ? calcVariacion(t, firstOfMonth.total) : null,
    anual:   firstOfYear  ? calcVariacion(t, firstOfYear.total)  : null,
  };
}

/** Formatea número como COP: $ 1.234.567 */
function formatCOP(amount) {
  if (amount == null) return 'N/A';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

/** Formatea porcentaje con signo: +1.23% / -0.45% */
function formatPct(value) {
  if (value == null) return 'N/A';
  return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
}

/**
 * Parsea número en formato colombiano "1.234.567,89" a float JS.
 * También maneja formato estándar con punto decimal.
 */
function parseColombianNumber(text) {
  if (!text) return null;
  // Quita símbolos excepto dígitos, punto y coma
  let s = String(text).replace(/[^\d,.-]/g, '');
  // Si tiene coma como separador decimal (formato CO): 1.234.567,89
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

module.exports = { calcVariacion, getVariaciones, formatCOP, formatPct, parseColombianNumber };
