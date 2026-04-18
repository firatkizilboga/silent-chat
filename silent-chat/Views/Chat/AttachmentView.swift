import SwiftUI

// MARK: - AttachmentView
/// Renders a decrypted `Attachment`.
/// - Images: Displayed inline with tap-to-fullscreen
/// - Everything else: Simple download card with filename + size
struct AttachmentView: View {
    let attachment: Attachment
    @State private var showFullScreen = false
    @State private var showShareSheet = false

    var body: some View {
        Group {
            if attachment.category == .image {
                imageView
            } else {
                downloadView
            }
        }
    }

    // MARK: - Image

    @ViewBuilder
    private var imageView: some View {
        if let uiImage = FileService.shared.cachedImage(for: attachment) {
            let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(uiImage.size, contentMode: .fit)
                .frame(maxWidth: 280, maxHeight: 360)
                .clipShape(shape)
                .overlay(shape.stroke(.white.opacity(0.08), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.18), radius: 8, x: 0, y: 3)
                .contentShape(shape)
                .onTapGesture { showFullScreen = true }
                .fullScreenCover(isPresented: $showFullScreen) {
                    FullScreenImageView(image: uiImage, attachment: attachment)
                }
        } else {
            HStack(spacing: 8) {
                Image(systemName: "photo")
                    .foregroundStyle(.secondary)
                Text("Image unavailable")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    // MARK: - Download (non-image)

    private var downloadView: some View {
        Button {
            showShareSheet = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: attachment.iconName)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 2) {
                    Text(attachment.name)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Text(attachment.formattedSize)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Image(systemName: "arrow.down.circle")
                    .font(.title3)
                    .foregroundStyle(.blue)
            }
            .padding(12)
            .frame(maxWidth: 260)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showShareSheet) {
            if let data = attachment.decodedData {
                ShareSheet(items: [data])
            }
        }
    }
}

// MARK: - Full Screen Image Viewer
struct FullScreenImageView: View {
    let image: UIImage
    let attachment: Attachment
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1.0
    @State private var showShareSheet = false

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(
                            width: geometry.size.width * scale,
                            height: geometry.size.height * scale
                        )
                        .frame(
                            minWidth: geometry.size.width,
                            minHeight: geometry.size.height
                        )
                }
            }
            .background(.black)
            .gesture(
                MagnificationGesture()
                    .onChanged { value in
                        scale = max(1.0, min(value, 5.0))
                    }
                    .onEnded { _ in
                        withAnimation(.spring(response: 0.3)) {
                            if scale < 1.2 { scale = 1.0 }
                        }
                    }
            )
            .onTapGesture(count: 2) {
                withAnimation(.spring(response: 0.3)) {
                    scale = scale > 1.0 ? 1.0 : 2.5
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("", systemImage: "xmark") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("", systemImage: "square.and.arrow.up") {
                        showShareSheet = true
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .sheet(isPresented: $showShareSheet) {
            if let data = attachment.decodedData {
                ShareSheet(items: [data])
            }
        }
    }
}

// MARK: - Share Sheet
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
