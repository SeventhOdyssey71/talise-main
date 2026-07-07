package io.talise.app.feature.receive

/**
 * Self-contained QR encoder — byte mode, ECC level M, versions 1-10 — matching
 * iOS `QRView` (CoreImage CIQRCodeGenerator with correctionLevel "M"). No
 * third-party dependency: the algorithm is a port of Project Nayuki's QR Code
 * generator (MIT), verified module-for-module against the reference `qrcode`
 * library across versions 1-10 and all eight masks, and round-tripped through
 * Apple's Vision barcode decoder for the real `sui:` / `talise://pay/` payloads.
 *
 * Version 10 holds 213 bytes at ECC M — far above the longest content this
 * screen encodes (a full 66-char Sui address plus an amount query).
 */
internal object QrCode {

    /** Encodes [text] (UTF-8, byte mode) as a square module matrix where `true` is a dark module, or null if it cannot fit. */
    fun encode(text: String): Array<BooleanArray>? {
        val data = text.encodeToByteArray()
        val ver = fitVersion(data.size) ?: return null

        // Segment header + payload, then terminator, byte alignment and pad codewords.
        val bits = ArrayList<Boolean>()
        appendBits(bits, 0b0100, 4)
        appendBits(bits, data.size, charCountBits(ver))
        for (b in data) appendBits(bits, b.toInt() and 0xFF, 8)
        val capacityBits = numDataCodewords(ver) * 8
        appendBits(bits, 0, minOf(4, capacityBits - bits.size))
        appendBits(bits, 0, (8 - bits.size % 8) % 8)
        var pad = 0xEC
        while (bits.size < capacityBits) {
            appendBits(bits, pad, 8)
            pad = 0xFD xor pad // alternates 0xEC / 0x11
        }
        val codewords = IntArray(bits.size / 8)
        for (i in bits.indices) {
            if (bits[i]) codewords[i shr 3] = codewords[i shr 3] or (1 shl (7 - (i and 7)))
        }
        return Matrix(ver, codewords).modules
    }

    // ---- capacity ----

    private val ECC_CODEWORDS_PER_BLOCK_M = intArrayOf(10, 16, 26, 18, 24, 16, 18, 22, 22, 26)
    private val NUM_ERROR_CORRECTION_BLOCKS_M = intArrayOf(1, 1, 1, 2, 2, 4, 4, 4, 5, 5)
    private const val MIN_VERSION = 1
    private const val MAX_VERSION = 10

    private fun numRawDataModules(ver: Int): Int {
        val size = ver * 4 + 17
        var result = size * size
        result -= 8 * 8 * 3 // finders + separators
        result -= 15 * 2 + 1 // format info + dark module
        result -= (size - 16) * 2 // timing patterns
        if (ver >= 2) {
            val numAlign = ver / 7 + 2
            result -= (numAlign - 1) * (numAlign - 1) * 25
            result -= (numAlign - 2) * 2 * 20
            if (ver >= 7) result -= 6 * 3 * 2 // version info
        }
        return result
    }

    private fun numDataCodewords(ver: Int): Int =
        numRawDataModules(ver) / 8 -
            ECC_CODEWORDS_PER_BLOCK_M[ver - 1] * NUM_ERROR_CORRECTION_BLOCKS_M[ver - 1]

    private fun charCountBits(ver: Int): Int = if (ver <= 9) 8 else 16

    private fun fitVersion(dataLen: Int): Int? {
        for (ver in MIN_VERSION..MAX_VERSION) {
            if (4 + charCountBits(ver) + dataLen * 8 <= numDataCodewords(ver) * 8) return ver
        }
        return null
    }

    private fun appendBits(bits: ArrayList<Boolean>, value: Int, length: Int) {
        for (i in length - 1 downTo 0) bits.add((value ushr i) and 1 == 1)
    }

    // ---- Reed-Solomon over GF(2^8/0x11D) ----

    private fun rsMultiply(x: Int, y: Int): Int {
        var z = 0
        for (i in 7 downTo 0) {
            z = (z shl 1) xor ((z ushr 7) * 0x11D)
            z = z xor (((y ushr i) and 1) * x)
        }
        return z and 0xFF
    }

    private fun rsDivisor(degree: Int): IntArray {
        val result = IntArray(degree)
        result[degree - 1] = 1
        var root = 1
        repeat(degree) {
            for (j in 0 until degree) {
                result[j] = rsMultiply(result[j], root)
                if (j + 1 < degree) result[j] = result[j] xor result[j + 1]
            }
            root = rsMultiply(root, 0x02)
        }
        return result
    }

    private fun rsRemainder(data: IntArray, divisor: IntArray): IntArray {
        val result = IntArray(divisor.size)
        for (b in data) {
            val factor = b xor result[0]
            System.arraycopy(result, 1, result, 0, result.size - 1)
            result[result.size - 1] = 0
            for (j in divisor.indices) result[j] = result[j] xor rsMultiply(divisor[j], factor)
        }
        return result
    }

    private fun addEccAndInterleave(ver: Int, data: IntArray): IntArray {
        val numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[ver - 1]
        val blockEccLen = ECC_CODEWORDS_PER_BLOCK_M[ver - 1]
        val rawCodewords = numRawDataModules(ver) / 8
        val numShortBlocks = numBlocks - rawCodewords % numBlocks
        val shortBlockLen = rawCodewords / numBlocks

        // Split into blocks (short blocks first), append ECC, then interleave.
        val divisor = rsDivisor(blockEccLen)
        val blocks = ArrayList<IntArray>(numBlocks)
        var k = 0
        for (i in 0 until numBlocks) {
            val datLen = shortBlockLen - blockEccLen + (if (i < numShortBlocks) 0 else 1)
            val dat = data.copyOfRange(k, k + datLen)
            k += datLen
            val ecc = rsRemainder(dat, divisor)
            val block = IntArray(shortBlockLen + 1) // long-block length; short blocks leave one gap slot
            dat.copyInto(block)
            ecc.copyInto(block, block.size - blockEccLen)
            blocks.add(block)
        }
        val result = IntArray(rawCodewords)
        var idx = 0
        for (i in blocks[0].indices) {
            for (j in blocks.indices) {
                if (i != shortBlockLen - blockEccLen || j >= numShortBlocks) {
                    result[idx++] = blocks[j][i]
                }
            }
        }
        return result
    }

    // ---- symbol drawing ----

    private class Matrix(val ver: Int, dataCodewords: IntArray) {
        val size = ver * 4 + 17
        val modules = Array(size) { BooleanArray(size) }
        private val isFunction = Array(size) { BooleanArray(size) }

        init {
            drawFunctionPatterns()
            drawCodewords(QrCode.addEccAndInterleave(ver, dataCodewords))
            // Pick the mask with the lowest penalty score (XOR masking is involutory).
            var mask = 0
            var minPenalty = Int.MAX_VALUE
            for (i in 0 until 8) {
                applyMask(i)
                drawFormatBits(i)
                val penalty = penaltyScore()
                if (penalty < minPenalty) {
                    minPenalty = penalty
                    mask = i
                }
                applyMask(i)
            }
            applyMask(mask)
            drawFormatBits(mask)
        }

        private fun setFunctionModule(x: Int, y: Int, isDark: Boolean) {
            modules[y][x] = isDark
            isFunction[y][x] = true
        }

        private fun drawFunctionPatterns() {
            for (i in 0 until size) {
                setFunctionModule(6, i, i % 2 == 0)
                setFunctionModule(i, 6, i % 2 == 0)
            }
            drawFinderPattern(3, 3)
            drawFinderPattern(size - 4, 3)
            drawFinderPattern(3, size - 4)
            val alignPos = alignmentPatternPositions()
            val n = alignPos.size
            for (i in 0 until n) {
                for (j in 0 until n) {
                    // Skip the three corners occupied by finder patterns.
                    if (!((i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0))) {
                        drawAlignmentPattern(alignPos[i], alignPos[j])
                    }
                }
            }
            drawFormatBits(0) // dummy mask, overwritten after mask selection
            drawVersion()
        }

        private fun drawFinderPattern(x: Int, y: Int) {
            for (dy in -4..4) {
                for (dx in -4..4) {
                    val dist = maxOf(kotlin.math.abs(dx), kotlin.math.abs(dy))
                    val xx = x + dx
                    val yy = y + dy
                    if (xx in 0 until size && yy in 0 until size) {
                        setFunctionModule(xx, yy, dist != 2 && dist != 4)
                    }
                }
            }
        }

        private fun drawAlignmentPattern(x: Int, y: Int) {
            for (dy in -2..2) {
                for (dx in -2..2) {
                    setFunctionModule(x + dx, y + dy, maxOf(kotlin.math.abs(dx), kotlin.math.abs(dy)) != 1)
                }
            }
        }

        private fun alignmentPatternPositions(): IntArray {
            if (ver == 1) return IntArray(0)
            val numAlign = ver / 7 + 2
            val step = if (ver == 32) 26 else (ver * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2) * 2
            val result = IntArray(numAlign)
            result[0] = 6
            var pos = size - 7
            for (i in numAlign - 1 downTo 1) {
                result[i] = pos
                pos -= step
            }
            return result
        }

        private fun drawFormatBits(mask: Int) {
            val data = (0 shl 3) or mask // ECC level M has format value 0
            var rem = data
            repeat(10) { rem = (rem shl 1) xor ((rem ushr 9) * 0x537) }
            val bits = ((data shl 10) or rem) xor 0x5412

            for (i in 0..5) setFunctionModule(8, i, (bits ushr i) and 1 == 1)
            setFunctionModule(8, 7, (bits ushr 6) and 1 == 1)
            setFunctionModule(8, 8, (bits ushr 7) and 1 == 1)
            setFunctionModule(7, 8, (bits ushr 8) and 1 == 1)
            for (i in 9..14) setFunctionModule(14 - i, 8, (bits ushr i) and 1 == 1)

            for (i in 0..7) setFunctionModule(size - 1 - i, 8, (bits ushr i) and 1 == 1)
            for (i in 8..14) setFunctionModule(8, size - 15 + i, (bits ushr i) and 1 == 1)
            setFunctionModule(8, size - 8, true) // always-dark module
        }

        private fun drawVersion() {
            if (ver < 7) return
            var rem = ver
            repeat(12) { rem = (rem shl 1) xor ((rem ushr 11) * 0x1F25) }
            val bits = (ver shl 12) or rem
            for (i in 0 until 18) {
                val bit = (bits ushr i) and 1 == 1
                val a = size - 11 + i % 3
                val b = i / 3
                setFunctionModule(a, b, bit)
                setFunctionModule(b, a, bit)
            }
        }

        private fun drawCodewords(data: IntArray) {
            var i = 0
            var right = size - 1
            while (right >= 1) {
                if (right == 6) right = 5
                for (vert in 0 until size) {
                    for (j in 0 until 2) {
                        val x = right - j
                        val upward = ((right + 1) and 2) == 0
                        val y = if (upward) size - 1 - vert else vert
                        if (!isFunction[y][x] && i < data.size * 8) {
                            modules[y][x] = (data[i shr 3] ushr (7 - (i and 7))) and 1 == 1
                            i++
                        }
                    }
                }
                right -= 2
            }
        }

        private fun applyMask(mask: Int) {
            for (y in 0 until size) {
                for (x in 0 until size) {
                    val invert = when (mask) {
                        0 -> (x + y) % 2 == 0
                        1 -> y % 2 == 0
                        2 -> x % 3 == 0
                        3 -> (x + y) % 3 == 0
                        4 -> (x / 3 + y / 2) % 2 == 0
                        5 -> x * y % 2 + x * y % 3 == 0
                        6 -> (x * y % 2 + x * y % 3) % 2 == 0
                        else -> ((x + y) % 2 + x * y % 3) % 2 == 0
                    }
                    if (invert && !isFunction[y][x]) modules[y][x] = !modules[y][x]
                }
            }
        }

        // ---- ISO 18004 mask penalty ----

        private fun penaltyScore(): Int {
            var result = 0

            for (y in 0 until size) {
                var runColor = false
                var runX = 0
                val runHistory = IntArray(7)
                for (x in 0 until size) {
                    if (modules[y][x] == runColor) {
                        runX++
                        if (runX == 5) result += 3 else if (runX > 5) result++
                    } else {
                        finderPenaltyAddHistory(runX, runHistory)
                        if (!runColor) result += finderPenaltyCountPatterns(runHistory) * 40
                        runColor = modules[y][x]
                        runX = 1
                    }
                }
                result += finderPenaltyTerminateAndCount(runColor, runX, runHistory) * 40
            }

            for (x in 0 until size) {
                var runColor = false
                var runY = 0
                val runHistory = IntArray(7)
                for (y in 0 until size) {
                    if (modules[y][x] == runColor) {
                        runY++
                        if (runY == 5) result += 3 else if (runY > 5) result++
                    } else {
                        finderPenaltyAddHistory(runY, runHistory)
                        if (!runColor) result += finderPenaltyCountPatterns(runHistory) * 40
                        runColor = modules[y][x]
                        runY = 1
                    }
                }
                result += finderPenaltyTerminateAndCount(runColor, runY, runHistory) * 40
            }

            for (y in 0 until size - 1) {
                for (x in 0 until size - 1) {
                    val color = modules[y][x]
                    if (color == modules[y][x + 1] && color == modules[y + 1][x] && color == modules[y + 1][x + 1]) {
                        result += 3
                    }
                }
            }

            var dark = 0
            for (row in modules) for (cell in row) if (cell) dark++
            val total = size * size
            val k = (kotlin.math.abs(dark * 20 - total * 10) + total - 1) / total - 1
            result += k * 10
            return result
        }

        private fun finderPenaltyCountPatterns(runHistory: IntArray): Int {
            val n = runHistory[1]
            val core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3 &&
                runHistory[4] == n && runHistory[5] == n
            return (if (core && runHistory[0] >= n * 4 && runHistory[6] >= n) 1 else 0) +
                (if (core && runHistory[6] >= n * 4 && runHistory[0] >= n) 1 else 0)
        }

        private fun finderPenaltyTerminateAndCount(
            currentRunColor: Boolean,
            currentRunLength: Int,
            runHistory: IntArray,
        ): Int {
            var length = currentRunLength
            if (currentRunColor) {
                finderPenaltyAddHistory(length, runHistory)
                length = 0
            }
            length += size // light border around the symbol
            finderPenaltyAddHistory(length, runHistory)
            return finderPenaltyCountPatterns(runHistory)
        }

        private fun finderPenaltyAddHistory(currentRunLength: Int, runHistory: IntArray) {
            var length = currentRunLength
            if (runHistory[0] == 0) length += size // light border counts toward the first run
            System.arraycopy(runHistory, 0, runHistory, 1, runHistory.size - 1)
            runHistory[0] = length
        }
    }
}
