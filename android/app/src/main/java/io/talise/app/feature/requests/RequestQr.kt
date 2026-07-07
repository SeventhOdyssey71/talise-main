package io.talise.app.feature.requests

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import kotlin.math.abs

/**
 * QR render for the request pay link, the Android counterpart of iOS `QRView`
 * (CIQRCodeGenerator, correction level "M"). No QR library is allowed in the
 * dependency set, so the matrix comes from [encodeQrMatrix], a small
 * self-contained byte-mode encoder (EC level M, versions 1-10, mask 0), and is
 * drawn crisp (no interpolation) on the caller-supplied white card. Falls back
 * to a gray fill when the content can't be encoded, exactly like iOS.
 */
@Composable
internal fun QrView(content: String, modifier: Modifier = Modifier) {
    val matrix = remember(content) { encodeQrMatrix(content) }
    if (matrix == null) {
        Box(modifier.background(Color.Gray))
        return
    }
    Canvas(modifier) {
        val n = matrix.size
        val cell = size.minDimension / n
        drawRect(Color.White)
        for (y in 0 until n) {
            for (x in 0 until n) {
                if (matrix[y][x]) {
                    drawRect(
                        color = Color.Black,
                        topLeft = Offset(x * cell, y * cell),
                        size = Size(cell + 0.5f, cell + 0.5f),
                    )
                }
            }
        }
    }
}

// MARK: - Encoder (byte mode, EC level M, versions 1-10, mask 0)

/** Error-correction block structure at level M: ecPerBlock, then (count x dataCodewords) groups. */
private class EcSpec(val ecPerBlock: Int, val blocks1: Int, val data1: Int, val blocks2: Int, val data2: Int) {
    val dataCodewords: Int get() = blocks1 * data1 + blocks2 * data2
}

private val EC_M = arrayOf(
    EcSpec(10, 1, 16, 0, 0), // v1
    EcSpec(16, 1, 28, 0, 0), // v2
    EcSpec(26, 1, 44, 0, 0), // v3
    EcSpec(18, 2, 32, 0, 0), // v4
    EcSpec(24, 2, 43, 0, 0), // v5
    EcSpec(16, 4, 27, 0, 0), // v6
    EcSpec(18, 4, 31, 0, 0), // v7
    EcSpec(22, 2, 38, 2, 39), // v8
    EcSpec(22, 3, 36, 2, 37), // v9
    EcSpec(26, 4, 43, 1, 44), // v10
)

private val ALIGNMENT = arrayOf(
    intArrayOf(),
    intArrayOf(6, 18),
    intArrayOf(6, 22),
    intArrayOf(6, 26),
    intArrayOf(6, 30),
    intArrayOf(6, 34),
    intArrayOf(6, 22, 38),
    intArrayOf(6, 24, 42),
    intArrayOf(6, 26, 46),
    intArrayOf(6, 28, 50),
)

/** Encode `content` as a QR module matrix (true = dark), or null if it doesn't fit. */
internal fun encodeQrMatrix(content: String): Array<BooleanArray>? {
    val bytes = content.encodeToByteArray()

    // Smallest version whose data capacity fits mode(4) + count + payload bits.
    val version = (1..10).firstOrNull { v ->
        val countBits = if (v <= 9) 8 else 16
        4 + countBits + bytes.size * 8 <= EC_M[v - 1].dataCodewords * 8
    } ?: return null
    val spec = EC_M[version - 1]
    val countBits = if (version <= 9) 8 else 16
    val capacityBits = spec.dataCodewords * 8

    // Data bit stream: mode, count, payload, terminator, byte padding, pad codewords.
    val bits = ArrayList<Boolean>(capacityBits)
    fun append(value: Int, count: Int) {
        for (i in count - 1 downTo 0) bits.add(((value ushr i) and 1) != 0)
    }
    append(0b0100, 4)
    append(bytes.size, countBits)
    for (b in bytes) append(b.toInt() and 0xFF, 8)
    append(0, minOf(4, capacityBits - bits.size))
    if (bits.size % 8 != 0) append(0, 8 - bits.size % 8)
    var pad = 0xEC
    while (bits.size < capacityBits) {
        append(pad, 8)
        pad = if (pad == 0xEC) 0x11 else 0xEC
    }
    val data = ByteArray(bits.size / 8)
    for (i in bits.indices) {
        if (bits[i]) data[i shr 3] = (data[i shr 3].toInt() or (0x80 ushr (i and 7))).toByte()
    }

    // Split into blocks, compute Reed-Solomon ECC, interleave.
    val blocks = ArrayList<ByteArray>(spec.blocks1 + spec.blocks2)
    var off = 0
    repeat(spec.blocks1) {
        blocks.add(data.copyOfRange(off, off + spec.data1)); off += spec.data1
    }
    repeat(spec.blocks2) {
        blocks.add(data.copyOfRange(off, off + spec.data2)); off += spec.data2
    }
    val divisor = rsGenerator(spec.ecPerBlock)
    val eccs = blocks.map { rsRemainder(it, divisor) }
    val all = ArrayList<Byte>(spec.dataCodewords + spec.ecPerBlock * blocks.size)
    val maxData = blocks.maxOf { it.size }
    for (i in 0 until maxData) for (b in blocks) if (i < b.size) all.add(b[i])
    for (i in 0 until spec.ecPerBlock) for (e in eccs) all.add(e[i])
    val codewords = all.toByteArray()

    // Module matrix + function-pattern mask.
    val size = version * 4 + 17
    val modules = Array(size) { BooleanArray(size) }
    val isFunction = Array(size) { BooleanArray(size) }
    fun set(x: Int, y: Int, dark: Boolean) {
        modules[y][x] = dark
        isFunction[y][x] = true
    }

    // Timing patterns.
    for (i in 0 until size) {
        set(6, i, i % 2 == 0)
        set(i, 6, i % 2 == 0)
    }
    // Finder patterns + separators.
    fun finder(cx: Int, cy: Int) {
        for (dy in -4..4) for (dx in -4..4) {
            val x = cx + dx
            val y = cy + dy
            if (x in 0 until size && y in 0 until size) {
                val dist = maxOf(abs(dx), abs(dy))
                set(x, y, dist != 2 && dist != 4)
            }
        }
    }
    finder(3, 3)
    finder(size - 4, 3)
    finder(3, size - 4)
    // Alignment patterns (skip the three finder corners).
    val pos = ALIGNMENT[version - 1]
    for (i in pos.indices) for (j in pos.indices) {
        if ((i == 0 && j == 0) || (i == 0 && j == pos.size - 1) || (i == pos.size - 1 && j == 0)) continue
        for (dy in -2..2) for (dx in -2..2) {
            set(pos[i] + dx, pos[j] + dy, maxOf(abs(dx), abs(dy)) != 1)
        }
    }
    // Format bits: EC level M (indicator 00), mask 0, BCH(15,5) with 0x537, XOR 0x5412.
    var rem = 0
    repeat(10) { rem = (rem shl 1) xor ((rem ushr 9) * 0x537) }
    val fbits = rem xor 0x5412
    fun fbit(i: Int) = ((fbits ushr i) and 1) != 0
    for (i in 0..5) set(8, i, fbit(i))
    set(8, 7, fbit(6))
    set(8, 8, fbit(7))
    set(7, 8, fbit(8))
    for (i in 9..14) set(14 - i, 8, fbit(i))
    for (i in 0..7) set(size - 1 - i, 8, fbit(i))
    for (i in 8..14) set(8, size - 15 + i, fbit(i))
    set(8, size - 8, true) // fixed dark module
    // Version info (v7+): BCH(18,6) with 0x1F25.
    if (version >= 7) {
        var vrem = version
        repeat(12) { vrem = (vrem shl 1) xor ((vrem ushr 11) * 0x1F25) }
        val vbits = (version shl 12) or vrem
        for (i in 0..17) {
            val dark = ((vbits ushr i) and 1) != 0
            val a = size - 11 + i % 3
            val b = i / 3
            set(a, b, dark)
            set(b, a, dark)
        }
    }

    // Zigzag codeword placement with mask 0 ((x + y) % 2 == 0) applied inline.
    var bitIndex = 0
    val totalBits = codewords.size * 8
    var right = size - 1
    while (right >= 1) {
        if (right == 6) right = 5
        for (vert in 0 until size) {
            for (j in 0..1) {
                val x = right - j
                val upward = ((right + 1) and 2) == 0
                val y = if (upward) size - 1 - vert else vert
                if (!isFunction[y][x]) {
                    var dark = false
                    if (bitIndex < totalBits) {
                        dark = ((codewords[bitIndex ushr 3].toInt() ushr (7 - (bitIndex and 7))) and 1) != 0
                        bitIndex++
                    }
                    if ((x + y) % 2 == 0) dark = !dark
                    modules[y][x] = dark
                }
            }
        }
        right -= 2
    }
    return modules
}

// MARK: - GF(256) Reed-Solomon (polynomial 0x11D)

private fun gfMul(x: Int, y: Int): Int {
    var z = 0
    for (i in 7 downTo 0) {
        z = (z shl 1) xor ((z ushr 7) * 0x11D)
        z = z xor (((y ushr i) and 1) * x)
    }
    return z
}

private fun rsGenerator(degree: Int): ByteArray {
    val result = ByteArray(degree)
    result[degree - 1] = 1
    var root = 1
    for (i in 0 until degree) {
        for (j in result.indices) {
            var v = gfMul(result[j].toInt() and 0xFF, root)
            if (j + 1 < result.size) v = v xor (result[j + 1].toInt() and 0xFF)
            result[j] = v.toByte()
        }
        root = gfMul(root, 0x02)
    }
    return result
}

private fun rsRemainder(data: ByteArray, divisor: ByteArray): ByteArray {
    val result = ByteArray(divisor.size)
    for (b in data) {
        val factor = (b.toInt() xor result[0].toInt()) and 0xFF
        System.arraycopy(result, 1, result, 0, result.size - 1)
        result[result.size - 1] = 0
        for (i in divisor.indices) {
            result[i] = (result[i].toInt() xor gfMul(divisor[i].toInt() and 0xFF, factor)).toByte()
        }
    }
    return result
}
