const fs = require('fs');
const path = require('path');

function trimWhitespace(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.split('\n').map(line => line.trimEnd()).join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
}

const bookingsPath = path.join(__dirname, 'artifacts/central/app/(tabs)/bookings.tsx');
const cardPath = path.join(__dirname, 'artifacts/central/components/BookingCard.tsx');

let bookingsContent = fs.readFileSync(bookingsPath, 'utf8');

// Replace the buttons
const oldCancelBtn = `<TouchableOpacity onPress={() => showToast("Cancellation Coming Soon")} style={{ flex: 1, height: 48, backgroundColor: "rgba(255,59,71,0.1)", borderWidth: 1, borderColor: "rgba(255,59,71,0.3)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}>
            <Ionicons name="close-circle" size={16} color="#FF3B47" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FF3B47" }}>Cancel Booking</Text>
          </TouchableOpacity>`;

const newCancelBtn = `<View style={{ flex: 1, height: 48, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, opacity: 0.6 }}>
            <Ionicons name="close-circle" size={16} color="#6B747F" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" }}>Cancel (Soon)</Text>
          </View>`;

const oldReceiptBtn = `<TouchableOpacity onPress={() => showToast("Receipts Coming Soon")} style={{ flex: 1, height: 48, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}>
            <Ionicons name="download-outline" size={16} color="#FFFFFF" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FFFFFF" }}>Download Receipt</Text>
          </TouchableOpacity>`;

const newReceiptBtn = `<View style={{ flex: 1, height: 48, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, opacity: 0.6 }}>
            <Ionicons name="download-outline" size={16} color="#6B747F" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" }}>Receipt (Soon)</Text>
          </View>`;

if (bookingsContent.includes(oldCancelBtn)) {
  bookingsContent = bookingsContent.replace(oldCancelBtn, newCancelBtn);
}
if (bookingsContent.includes(oldReceiptBtn)) {
  bookingsContent = bookingsContent.replace(oldReceiptBtn, newReceiptBtn);
}

fs.writeFileSync(bookingsPath, bookingsContent, 'utf8');

trimWhitespace(bookingsPath);
trimWhitespace(cardPath);

console.log('Fixed buttons and stripped whitespaces.');
