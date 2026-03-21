import SwiftUI

struct ChatRowLabel: View {
    let alias: String
    let messageViewModel: MessageViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(alias)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
                if let timestamp = messageViewModel.latestMessageTimestamp(for: alias) {
                    Text(chatRowTimestampText(for: timestamp))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if messageViewModel.unreadPeers.contains(alias) {
                    Circle()
                        .frame(width: 8, height: 8)
                        .foregroundStyle(.red)
                }
            }
            if let preview = messageViewModel.latestMessagePreview(for: alias) {
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func chatRowTimestampText(for timestamp: Date) -> String {
        let calendar = Calendar.current
        let now = Date.now
        if calendar.isDateInToday(timestamp) {
            return timestamp.formatted(date: .omitted, time: .shortened)
        }
        if calendar.isDate(timestamp, equalTo: now, toGranularity: .weekOfYear) {
            return timestamp.formatted(.dateTime.weekday(.wide))
        }
        return timestamp.formatted(date: .numeric, time: .omitted)
    }
}
