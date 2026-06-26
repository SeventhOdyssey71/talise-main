package io.talise.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** Corner radii + spacing + sizing tokens, mirroring iOS `TaliseRadius`/`TaliseSpacing`/`TaliseHeight`. */
object TaliseRadius {
    val sm = 10.dp
    val md = 14.dp
    val lg = 20.dp
    val xl = 25.dp
    val pill = 40.dp

    val shapeSm = RoundedCornerShape(sm)
    val shapeMd = RoundedCornerShape(md)
    val shapeLg = RoundedCornerShape(lg)
    val shapeXl = RoundedCornerShape(xl)
    val shapePill = RoundedCornerShape(pill)
}

object TaliseSpacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp
}

object TaliseSize {
    val buttonSm = 32.dp
    val buttonMd = 40.dp
    val buttonLg = 44.dp
    val slideTrack = 58.dp
    val tabBar = 64.dp
}
