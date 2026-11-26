import { useStore } from "./store";

// Hindi strings: have a native speaker check these before stage use.
const HI: Record<string, string> = {
  "Ward status": "वार्ड स्थिति",
  "City clock": "नगर घड़ी",
  "Ward signals": "वार्ड के संकेत",
  "Probable ingress · unconfirmed": "संभावित रिसाव स्थल · अपुष्ट",
  "Suggested test taps": "सुझाए गए जाँच नल",
  "Complaints / day": "शिकायतें / दिन",
  "Pharmacy ORS / day": "दवा दुकान ORS / दिन",
  "Field tests": "फ़ील्ड जाँच",
  "Alert index": "चेतावनी सूचकांक",
  "Most likely ingress segments": "सबसे संभावित रिसाव स्थल",
  'Why here? Evidence vs. "no event"': "यहीं क्यों? साक्ष्य बनाम 'कोई घटना नहीं'",
  "Map legend": "नक्शा संकेत",
  Command: "कमान",
  Intake: "शिकायत व जाँच",
  Escalation: "जवाबदेही",
  Audit: "ऑडिट",
  Evidence: "प्रमाण",
  ALERT: "चेतावनी",
  NORMAL: "सामान्य",
  "No open alert": "कोई खुली चेतावनी नहीं",
  "No alert does not mean safe.": "चेतावनी न होना सुरक्षित होने का प्रमाण नहीं है।",
  "50 = threshold": "50 = सीमा",
  today: "आज",
  "failed total": "कुल विफल",
};

export function useT() {
  const lang = useStore((s) => s.lang);
  return (s: string) => (lang === "hi" ? HI[s] ?? s : s);
}
