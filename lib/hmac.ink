` SHA1 HMAC digest
	ported from https://gist.github.com/Seldaek/1730205 `

std := load('../vendor/std')
str := load('../vendor/str')

range := std.range
each := std.each
slice := std.slice
hex := std.hex
xeh := s => (std.xeh)((str.lower)(s))
lower := str.lower

XMAX := xeh('0ffffffff')

` fill for << `
lshift := (n, s) => (
	n := n % pow(2, 32)
	s := s % pow(2, 5)
	(n * pow(2, s)) % pow(2, 32)
)
` fill for >>> `
rshift := (n, s) => (
	n := n % pow(2, 32)
	s := s % pow(2, 5)
	floor(n / pow(2, s))
)
` logical negation, using two's complement system `
neg := n => ~n - 1

rotateLeft := (n, s) => lshift(n, s) | rshift(n, 32 - s)
cvt := val => (
	s := {str: ''}
	each(range(7, ~1, ~1), i => (
		v := rshift(val, i * 4) & xeh('0f')
		s.str := s.str + hex(v)
	))
	s.str
)

` sha1 hash algorithm `
hash := (msg, raw) => (
	W := []
	H := [
		xeh('67452301')
		xeh('EFCDAB89')
		xeh('98BADCFE')
		xeh('10325476')
		xeh('C3D2E1F0')
	]

	msgLen := len(msg)

	wordArray := []
	each(range(0, msgLen - 3, 4), i => (
		j := lshift(point(msg.(i)), 24) | lshift(point(msg.(i + 1)), 16) | lshift(point(msg.(i + 2)), 8) | point(msg.(i + 3))
		wordArray.len(wordArray) := j
	))

	wordArray.len(wordArray) := (msgLen % 4 :: {
		0 -> xeh('080000000')
		1 -> lshift(point(msg.(msgLen - 1)), 24) | xeh('0800000')
		2 -> lshift(point(msg.(msgLen - 2)), 24) | lshift(point(msg.(msgLen - 1)), 16) | xeh('08000')
		3 -> lshift(point(msg.(msgLen - 3)), 24) | lshift(point(msg.(msgLen - 2)), 16) | lshift(point(msg.(msgLen - 1)), 8) | xeh('080')
	})

	(sub := () => len(wordArray) % 16 :: {
		14 -> ()
		_ -> (
			wordArray.len(wordArray) := 0
			sub()
		)
	})()

	wordArray.len(wordArray) := rshift(msgLen, 29)
	wordArray.len(wordArray) := lshift(msgLen, 3) & XMAX

	each(range(0, len(wordArray), 16), blockstart => (
		X := {
			A: H.0
			B: H.1
			C: H.2
			D: H.3
			E: H.4
		}

		each(
			range(0, 16, 1)
			i => W.(i) := wordArray.(blockstart + i)
		)
		each(
			range(16, 80, 1)
			i => W.(i) := rotateLeft(W.(i - 3) ^ W.(i - 8) ^ W.(i - 14) ^ W.(i - 16), 1)
		)

		each(range(0, 20, 1), i => (
			temp := (rotateLeft(X.A, 5) + ((X.B & X.C) | (neg(X.B) & X.D)) + X.E + W.(i) + xeh('5A827999')) & XMAX
			X.E := X.D
			X.D := X.C
			X.C := rotateLeft(X.B, 30)
			X.B := X.A
			X.A := temp
		))
		each(range(20, 40, 1), i => (
			temp := (rotateLeft(X.A, 5) + (X.B ^ X.C ^ X.D) + X.E + W.(i) + xeh('6ED9EBA1')) & XMAX
			X.E := X.D
			X.D := X.C
			X.C := rotateLeft(X.B, 30)
			X.B := X.A
			X.A := temp
		))
		each(range(40, 60, 1), i => (
			temp := (rotateLeft(X.A, 5) + ((X.B & X.C) | (X.B & X.D) | (X.C & X.D)) + X.E + W.(i) + xeh('8F1BBCDC')) & XMAX
			X.E := X.D
			X.D := X.C
			X.C := rotateLeft(X.B, 30)
			X.B := X.A
			X.A := temp
		))
		each(range(60, 80, 1), i => (
			temp := (rotateLeft(X.A, 5) + (X.B ^ X.C ^ X.D) + X.E + W.(i) + xeh('CA62C1D6')) & XMAX
			X.E := X.D
			X.D := X.C
			X.C := rotateLeft(X.B, 30)
			X.B := X.A
			X.A := temp
		))

		H.0 := (H.0 + X.A) & XMAX
		H.1 := (H.1 + X.B) & XMAX
		H.2 := (H.2 + X.C) & XMAX
		H.3 := (H.3 + X.D) & XMAX
		H.4 := (H.4 + X.E) & XMAX
	))

	result := lower(cvt(H.0) + cvt(H.1) + cvt(H.2) + cvt(H.3) + cvt(H.4))

	raw :: {
		false -> result
		true -> (sub := (result, rawResult) => len(result) :: {
			0 -> rawResult
			_ -> sub(
				slice(result, 2, len(result))
				rawResult + char(xeh(slice(result, 0, 2)))
			)
		})(result, '')
	}
)

` actual hmac algorithm `
sha1 := (msg, key) => (
	key := (len(key) > 64 :: {
		true -> hash(key, true)
		false -> key
	})

	jlen := len(key)
	bytes := []
	each(range(0, 64, 1), i => bytes.(i) := (jlen > i :: {
		true -> point(key.(i))
		false -> 0
	}))

	keyPads := {
		o: ''
		i: ''
	}

	each(range(0, 64, 1), i => (
		keyPads.o := keyPads.o + char(bytes.(i) ^ xeh('5c'))
		keyPads.i := keyPads.i + char(bytes.(i) ^ xeh('36'))
	))

	iPadRes := hash(keyPads.i + msg, true)
	hash(keyPads.o + iPadRes, false)
)
