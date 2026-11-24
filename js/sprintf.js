/**
 * sprintf(format, arg1, arg2, ...) - formats a string.
 *
 * A conversion looks like %[-][+ or space][0][width][.precision]type:
 *   -          align to the left
 *   + or space what to put before a number that is not negative
 *   0          pad with zeros instead of spaces
 *   width      minimal length of the result
 *   .precision one digit: decimal places for "f", maximal length for "s"
 *   type       b, o, x, X (binary, octal, hex), c (character), d (integer), f (float), s (string)
 * "%%" gives a percent sign.
 *
 * Returns null when the format is not a string or there are fewer arguments than conversions.
 */
var sprintf = (function () {
	var CONVERSION = /%(?:%|(-)?([+ ])?(0)?(\d+)?(?:\.(\d)?)?([bcdfosxX]))/g;
	var RADIX = {b: 2, o: 8, x: 16, X: 16};
	var UNSIGNED = {b: true, c: true, s: true};

	function repeat(character, count) {
		return new Array(count > 0 ? count + 1 : 0).join(character);
	}

	function toText(type, value, precision) {
		if (type == 's') {
			return precision ? value.substring(0, precision) : value;
		}
		if (type == 'f') {
			return Math.abs(parseFloat(value)).toFixed(precision ? precision : 6);
		}
		var integer = Math.abs(parseInt(value));
		if (type == 'c') {
			return String.fromCharCode(parseInt(integer));
		}
		return integer.toString(RADIX[type] || 10);
	}

	return function (format) {
		if (typeof format != 'string') {
			return null;
		}
		var args = arguments;
		var used = 0;
		var result = format.replace(CONVERSION, function (all, left, plus, zero, width, precision, type) {
			if (!type) {
				return '%';
			}
			var arg = args[++used];
			var negative = parseFloat(arg) < 0;
			var text = toText(type, String(arg), precision);
			var sign = UNSIGNED[type] ? '' : (negative ? '-' : (plus || ''));
			var padding = (width || 0) - text.length - sign.length;
			if (left) {
				text = sign + text + repeat(' ', padding);
			} else if (zero) {
				text = sign + repeat('0', padding) + text;
			} else {
				text = repeat(' ', padding) + sign + text;
			}
			return type == 'X' ? text.toUpperCase() : text;
		});
		return used < args.length ? result : null;
	};
})();
