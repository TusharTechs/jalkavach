import { useStore } from "./store";

// Hindi UI strings. Reviewed against an Indore reader's corrections (round 2); a native-speaker
// check before stage use is still recommended.
const HI: Record<string, string> = {
  // top bar + status
  "Ward status": "वार्ड स्थिति",
  "Ward 00": "वार्ड 00",
  "City clock": "नगर घड़ी",
  simulation: "सिमुलेशन",
  Day: "दिन",
  "supply ON": "सप्लाई चालू",
  "supply OFF": "सप्लाई बंद",
  ALERT: "चेतावनी",
  NORMAL: "सामान्य",
  "No open alert": "कोई खुली चेतावनी नहीं",
  "Alert index": "चेतावनी सूचकांक",
  "Alert index · 50 = city threshold": "चेतावनी सूचकांक · 50 = शहर की सीमा",
  "to search": "खोजना बाकी",
  "city threshold 50": "शहर की सीमा 50",
  "SIMULATED SCENARIO": "सिम्युलेटेड परिदृश्य",
  overdue: "देर",
  "due in": "बाकी समय",
  "Session reset": "सत्र रीसेट",
  // signals
  "Ward signals": "वार्ड के संकेत",
  "Complaints / day": "शिकायतें / दिन",
  "Pharmacy ORS / day": "मेडिकल स्टोर ORS बिक्री / दिन",
  "Field tests": "जल परीक्षण",
  today: "आज",
  "failed total": "कुल विफल",
  "50 = threshold": "50 = सीमा",
  "illustrative partner stores · simulated counts · band = normal range": "उदाहरण हेतु साझेदार स्टोर · सिम्युलेटेड आँकड़े · पट्टी = सामान्य दायरा",
  // belief
  "Where to test first · search area": "पहले कहाँ जाँचें · खोज क्षेत्र",
  "km of pipe": "किमी पाइप",
  "Probable ingress · unconfirmed": "संभावित दूषित-जल प्रवेश स्थल · अपुष्ट",
  "Most likely ingress segments": "सबसे संभावित दूषित-जल प्रवेश स्थल",
  'Why here? Evidence vs. "no event"': "यहीं क्यों? साक्ष्य बनाम 'कोई घटना नहीं'",
  "Suggested test taps": "सुझाए गए जाँच नल",
  "people could be supplied through these pipes": "लोगों तक इन पाइपों से पानी पहुँच सकता है",
  "Engine status": "इंजन स्थिति",
  "No alert does not mean safe.": "चेतावनी न होना सुरक्षित होने का प्रमाण नहीं है।",
  "Field tests remain the ground truth.": "जल परीक्षण ही अंतिम प्रमाण है।",
  Complaints: "शिकायतें",
  Pharmacy: "मेडिकल स्टोर",
  // map
  "Map legend": "नक्शे के संकेत",
  "Pipes: synthetic, on real streets": "पाइप: काल्पनिक, असली सड़कों पर",
  "Flow (supply hours)": "प्रवाह (सप्लाई के घंटे)",
  "Low pressure (supply off)": "कम दबाव (सप्लाई बंद)",
  "Complaints, last 3 days": "शिकायतें, पिछले 3 दिन",
  "Test passed / ✕ failed": "परीक्षण सही / ✕ विफल",
  "Partner store (illustrative)": "साझेदार स्टोर (उदाहरण)",
  "Height = probability": "ऊँचाई = संभावना",
  "Plume if #1 is the source": "फैलाव, यदि #1 स्रोत है",
  "Suggested test tap": "सुझाया गया जाँच नल",
  "Buildings: OSM, heights illustrative": "इमारतें: OSM, ऊँचाई उदाहरण",
  "pipes touching the 90% credible set": "90% विश्वसनीय समूह को छूते पाइप",
  "junctions": "जंक्शन",
  "of": "में से",
  "Top 3 hold": "शीर्ष 3 में",
  "of the probability · onset est. day": "संभावना · शुरुआत का अनुमान दिन",
  'how strongly each signal favours "an event here" over "nothing is happening" (log-likelihood ratio)': "हर संकेत 'यहाँ घटना' को 'कुछ नहीं हो रहा' से कितना अधिक समर्थन देता है (लॉग-लाइकलिहुड अनुपात)",
  "Acknowledge alert": "चेतावनी स्वीकार करें",
  "Take field tests at suggested taps": "सुझाए नलों पर जल परीक्षण",
  "Confirm or clear; issue work order": "पुष्टि या रद्द; कार्य आदेश",
  "SLA missed by": "समय-सीमा पार",
  "Alert confirmed": "चेतावनी की पुष्टि",
  "Alert cleared": "चेतावनी रद्द",
  Flow: "प्रवाह",
  Plume: "फैलाव",
  Odds: "संभावना",
  "3D": "3D",
  unconfirmed: "अपुष्ट",
  // dock
  Command: "कमांड केंद्र",
  Intake: "शिकायत व जाँच",
  Escalation: "जवाबदेही",
  Audit: "ऑडिट",
  Evidence: "साक्ष्य",
  "2036": "2036",
  "Play the story (P)": "कहानी चलाएँ (P)",
  // timeline
  "JalKavach alert": "जलकवच चेतावनी",
  "Hospital-only baseline would alert ≈ day": "केवल अस्पताल-आधारित तरीका चेतावनी देता ≈ दिन",
  "days earlier": "दिन पहले",
  Hour: "घंटा",
  "bars = complaints / day · dots = field tests (✕ = below 0.2 mg/L)": "पट्टियाँ = शिकायतें / दिन · बिंदु = जल परीक्षण (✕ = 0.2 mg/L से कम)",
  "cyan = supply hours · ← → day · space play": "नीला = सप्लाई के घंटे · ← → दिन · स्पेस = चलाएँ",
  // drawers
  "Complaint & field-test intake": "शिकायत और जल परीक्षण दर्ज करें",
  "Citizen voice note": "नागरिक की आवाज़",
  "Field-test photo": "परीक्षण की फ़ोटो",
  "Record live": "अभी रिकॉर्ड करें",
  "Stop & transcribe": "रोकें और लिखें",
  "Transcribe & understand": "लिखें और समझें",
  Transcript: "लिखित पाठ",
  Understood: "समझा गया",
  "Show on map": "नक्शे पर दिखाएँ",
  "Add to evidence": "साक्ष्य में जोड़ें",
  "Which one? Several places match:": "कौन-सा? कई जगहें मिलती हैं:",
  "Alert & the city's escalation clock": "चेतावनी और शहर की जवाबदेही घड़ी",
  "Field tests taken": "जल परीक्षण हो गए",
  "Confirm ingress · create drafts": "प्रवेश की पुष्टि · ड्राफ़्ट बनाएँ",
  "Clear (false alarm)": "रद्द करें (गलत चेतावनी)",
  "Reason for delay (recorded in the audit trail)": "देरी का कारण (ऑडिट में दर्ज होगा)",
  "Tamper-evident audit trail": "छेड़छाड़-रोधी ऑडिट रिकॉर्ड",
  "Evidence · held-out simulation, pre-registered": "साक्ष्य · अलग रखे सिमुलेशन, पहले से घोषित मानदंड",
  "2036 · from one ward to every tap": "2036 · एक वार्ड से हर नल तक",
  "Signed in as (demo role)": "किस भूमिका में (डेमो)",
  "Audio is processed on this laptop and not stored. No phone numbers are kept. Purpose: locating unsafe water only.":
    "आवाज़ इसी लैपटॉप पर प्रोसेस होती है, सहेजी नहीं जाती। कोई फ़ोन नंबर नहीं रखा जाता। उद्देश्य: केवल असुरक्षित पानी का स्थान पता करना।",
};

export function useT() {
  const lang = useStore((s) => s.lang);
  return (s: string) => (lang === "hi" ? HI[s] ?? s : s);
}

/** Pick the Hindi or English label of a place. */
export function useL() {
  const lang = useStore((s) => s.lang);
  return (x: { label?: string; label_hi?: string } | null | undefined) => (lang === "hi" && x?.label_hi ? x.label_hi : x?.label ?? "");
}
