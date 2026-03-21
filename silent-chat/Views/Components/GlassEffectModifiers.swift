import SwiftUI

/// Backwards-compatible modifier that applies `.glassEffect(in: .circle)` on iOS 26+
/// and falls back to a translucent material background on earlier versions.
struct CircleGlassEffect: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(in: .circle)
        } else {
            content
                .background(.ultraThinMaterial, in: .circle)
        }
    }
}

/// Backwards-compatible modifier that applies `.glassEffect(in: .capsule)` on iOS 26+
/// and falls back to a translucent material background on earlier versions.
struct CapsuleGlassEffect: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(in: .capsule)
        } else {
            content
                .background(.ultraThinMaterial, in: .capsule)
        }
    }
}

extension View {
    /// Applies a Liquid Glass circle effect on iOS 26+, falling back to
    /// an `.ultraThinMaterial` circle background on earlier versions.
    func circleGlassEffect() -> some View {
        modifier(CircleGlassEffect())
    }

    /// Applies a Liquid Glass capsule effect on iOS 26+, falling back to
    /// an `.ultraThinMaterial` capsule background on earlier versions.
    func capsuleGlassEffect() -> some View {
        modifier(CapsuleGlassEffect())
    }
}
