import SwiftUI

@MainActor
final class KaraokeQueueStore: ObservableObject {
    @Published private(set) var items: [MobileKaraokePackage] = []
    @Published private(set) var currentPackageID: UUID?

    var currentPackage: MobileKaraokePackage? {
        items.first { $0.id == currentPackageID }
    }

    var nextPackage: MobileKaraokePackage? {
        item(offsetFromCurrent: 1)
    }

    func enqueue(_ package: MobileKaraokePackage) {
        guard !items.contains(where: { $0.id == package.id }) else { return }
        items.append(package)
    }

    func playNow(_ package: MobileKaraokePackage) {
        enqueue(package)
        currentPackageID = package.id
    }

    func advance() -> MobileKaraokePackage? {
        guard let next = item(offsetFromCurrent: 1) else { return nil }
        currentPackageID = next.id
        return next
    }

    func select(_ package: MobileKaraokePackage) {
        guard items.contains(where: { $0.id == package.id }) else { return }
        currentPackageID = package.id
    }

    func remove(at offsets: IndexSet) {
        let removedCurrent = offsets.contains { items[$0].id == currentPackageID }
        items.remove(atOffsets: offsets)
        if removedCurrent {
            currentPackageID = nil
        }
    }

    func move(from offsets: IndexSet, to destination: Int) {
        items.move(fromOffsets: offsets, toOffset: destination)
    }

    func clear() {
        items.removeAll()
        currentPackageID = nil
    }

    func contains(_ package: MobileKaraokePackage) -> Bool {
        items.contains { $0.id == package.id }
    }

    private func item(offsetFromCurrent offset: Int) -> MobileKaraokePackage? {
        guard let currentPackageID,
              let index = items.firstIndex(where: { $0.id == currentPackageID }) else {
            return offset > 0 ? items.first : nil
        }
        let target = index + offset
        return items.indices.contains(target) ? items[target] : nil
    }
}
