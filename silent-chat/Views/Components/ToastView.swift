import SwiftUI

struct ToastView: View {
    let sender: String
    let text: String
    let onTap: () -> Void
    let onDismiss: () -> Void
    @State private var dragOffset: CGSize = .zero

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(sender)
                        .font(.footnote.weight(.semibold))
                    Text(text)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .glassEffect(in: .capsule)
            .shadow(radius: 8, y: 4)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .offset(y: dragOffset.height)
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { value in
                    if value.translation.height < 0 {
                        dragOffset = value.translation
                    }
                }
                .onEnded { value in
                    if value.translation.height < -30 {
                        onDismiss()
                    } else {
                        dragOffset = .zero
                    }
                }
        )
    }
}
