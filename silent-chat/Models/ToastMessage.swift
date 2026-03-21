import Foundation

struct ToastMessage: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let senderAlias: String
}
