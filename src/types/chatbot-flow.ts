import type { Database } from "@/integrations/supabase/types";

// Flow node types
export type NodeType =
  | "greeting"
  | "question"
  | "date_buttons"
  | "api_check"
  | "condition"
  | "action"
  | "confirmation"
  | "end";

export interface FlowNodePosition {
  x: number;
  y: number;
}

export interface FlowNodeOption {
  label: string;
  value: string;
  nextNodeId: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  label: string;
  message: Record<string, string>; // language code -> message text
  dataField?: string; // maps to a field in the booking/lead record
  validationType?: "text" | "phone" | "number" | "date" | "email" | "selection";
  options?: FlowNodeOption[];
  nextNodeId?: string;
  position: FlowNodePosition;
  metadata?: Record<string, unknown>;
}

export interface FlowConnection {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
}

export interface FlowData {
  nodes: FlowNode[];
  connections: FlowConnection[];
  startNodeId: string;
  version: number;
}

// Collected data from chatbot conversation
export interface ChatbotCollectedData {
  customer_name?: string;
  phone_number?: string;
  vehicle_type?: string;
  vehicle_model?: string;
  registration_number?: string;
  kms_driven?: number;
  service_type?: string;
  issue_description?: string;
  preferred_date?: string;
  preferred_time?: string;
  pickup_required?: boolean;
  drop_required?: boolean;
  // Test drive specific
  email?: string;
  [key: string]: unknown;
}

// Pre-built flow templates
export const SERVICE_BOOKING_FLOW: FlowData = {
  version: 1,
  startNodeId: "greeting",
  nodes: [
    {
      id: "greeting",
      type: "greeting",
      label: "Greeting",
      message: {
        en: "👋 Welcome! I'm your service assistant. I'll help you book a vehicle service appointment. Let's get started!",
        hi: "👋 स्वागत है! मैं आपका सेवा सहायक हूं। मैं आपको वाहन सेवा अपॉइंटमेंट बुक करने में मदद करूंगा।",
        ar: "👋 مرحبًا! أنا مساعد الخدمة الخاص بك. سأساعدك في حجز موعد خدمة السيارة.",
      },
      nextNodeId: "ask_name",
      position: { x: 400, y: 50 },
    },
    {
      id: "ask_name",
      type: "question",
      label: "Ask Name",
      message: {
        en: "What's your full name?",
        hi: "आपका पूरा नाम क्या है?",
        ar: "ما هو اسمك الكامل؟",
      },
      dataField: "customer_name",
      validationType: "text",
      nextNodeId: "ask_phone",
      position: { x: 400, y: 140 },
    },
    {
      id: "ask_phone",
      type: "question",
      label: "Ask Phone",
      message: {
        en: "Please share your phone number.",
        hi: "कृपया अपना फोन नंबर साझा करें।",
        ar: "يرجى مشاركة رقم هاتفك.",
      },
      dataField: "phone_number",
      validationType: "phone",
      nextNodeId: "ask_vehicle_type",
      position: { x: 400, y: 230 },
    },
    {
      id: "ask_vehicle_type",
      type: "question",
      label: "Ask Vehicle Type",
      message: {
        en: "What type of vehicle do you have?",
        hi: "आपके पास किस प्रकार का वाहन है?",
        ar: "ما نوع سيارتك؟",
      },
      dataField: "vehicle_type",
      validationType: "selection",
      options: [
        { label: "Car", value: "car", nextNodeId: "ask_vehicle_model" },
        { label: "SUV", value: "suv", nextNodeId: "ask_vehicle_model" },
        { label: "Truck", value: "truck", nextNodeId: "ask_vehicle_model" },
        { label: "Van", value: "van", nextNodeId: "ask_vehicle_model" },
      ],
      position: { x: 400, y: 320 },
    },
    {
      id: "ask_vehicle_model",
      type: "question",
      label: "Ask Vehicle Model",
      message: {
        en: "What's the make and model of your vehicle? (e.g., Toyota Camry)",
        hi: "आपके वाहन का मेक और मॉडल क्या है? (जैसे, Toyota Camry)",
        ar: "ما هي ماركة وموديل سيارتك؟",
      },
      dataField: "vehicle_model",
      validationType: "text",
      nextNodeId: "ask_registration",
      position: { x: 400, y: 410 },
    },
    {
      id: "ask_registration",
      type: "question",
      label: "Ask Registration Number",
      message: {
        en: "What's your vehicle registration number?",
        hi: "आपके वाहन का रजिस्ट्रेशन नंबर क्या है?",
        ar: "ما هو رقم تسجيل سيارتك؟",
      },
      dataField: "registration_number",
      validationType: "text",
      nextNodeId: "ask_kms",
      position: { x: 400, y: 500 },
    },
    {
      id: "ask_kms",
      type: "question",
      label: "Ask KM Driven",
      message: {
        en: "How many kilometers has your vehicle driven?",
        hi: "आपके वाहन ने कितने किलोमीटर चलाए हैं?",
        ar: "كم كيلومتر قطعت سيارتك؟",
      },
      dataField: "kms_driven",
      validationType: "number",
      nextNodeId: "ask_service_type",
      position: { x: 400, y: 590 },
    },
    {
      id: "ask_service_type",
      type: "question",
      label: "Ask Service Type",
      message: {
        en: "What type of service do you need?",
        hi: "आपको किस प्रकार की सेवा चाहिए?",
        ar: "ما نوع الخدمة التي تحتاجها؟",
      },
      dataField: "service_type",
      validationType: "selection",
      options: [
        { label: "Regular Service", value: "regular", nextNodeId: "ask_issue" },
        { label: "Oil Change", value: "oil_change", nextNodeId: "ask_issue" },
        { label: "Brake Service", value: "brake", nextNodeId: "ask_issue" },
        { label: "AC Service", value: "ac", nextNodeId: "ask_issue" },
        { label: "Body Repair", value: "body_repair", nextNodeId: "ask_issue" },
        { label: "Other", value: "other", nextNodeId: "ask_issue" },
      ],
      position: { x: 400, y: 680 },
    },
    {
      id: "ask_issue",
      type: "question",
      label: "Ask Issue Description",
      message: {
        en: "Please describe any specific issues or concerns with your vehicle.",
        hi: "कृपया अपने वाहन की किसी विशेष समस्या का वर्णन करें।",
        ar: "يرجى وصف أي مشاكل محددة في سيارتك.",
      },
      dataField: "issue_description",
      validationType: "text",
      nextNodeId: "ask_date",
      position: { x: 400, y: 770 },
    },
    {
      id: "ask_date",
      type: "question",
      label: "Ask Preferred Date",
      message: {
        en: "When would you like to bring your vehicle in? (Please enter a date, e.g., 2025-01-15)",
        hi: "आप अपना वाहन कब लाना चाहेंगे? (कृपया तारीख दर्ज करें)",
        ar: "متى تريد إحضار سيارتك؟",
      },
      dataField: "preferred_date",
      validationType: "date",
      nextNodeId: "check_slots",
      position: { x: 400, y: 860 },
    },
    {
      id: "check_slots",
      type: "api_check",
      label: "Check Slot Availability",
      message: {
        en: "Let me check availability for that date...",
        hi: "मैं उस तारीख की उपलब्धता जांच रहा हूं...",
        ar: "دعني أتحقق من التوفر لهذا التاريخ...",
      },
      nextNodeId: "slot_decision",
      position: { x: 400, y: 950 },
      metadata: { checkType: "slot_availability", maxSlotsPerDay: 10 },
    },
    {
      id: "slot_decision",
      type: "condition",
      label: "Slot Available?",
      message: { en: "", hi: "", ar: "" },
      options: [
        { label: "Available", value: "available", nextNodeId: "ask_pickup" },
        { label: "Full", value: "full", nextNodeId: "suggest_alternative" },
      ],
      position: { x: 400, y: 1040 },
    },
    {
      id: "suggest_alternative",
      type: "question",
      label: "Suggest Alternative Date",
      message: {
        en: "Sorry, that date is fully booked. The next available date is {{alternative_date}}. Would you like to book for that date instead?",
        hi: "क्षमा करें, वह तारीख पूरी तरह बुक है। अगली उपलब्ध तारीख {{alternative_date}} है।",
        ar: "عذرًا، هذا التاريخ محجوز بالكامل. التاريخ المتاح التالي هو {{alternative_date}}.",
      },
      dataField: "preferred_date",
      validationType: "selection",
      options: [
        { label: "Yes, book alternative", value: "yes", nextNodeId: "ask_pickup" },
        { label: "Choose another date", value: "no", nextNodeId: "ask_date" },
      ],
      position: { x: 650, y: 1040 },
    },
    {
      id: "ask_pickup",
      type: "question",
      label: "Ask Pickup/Drop",
      message: {
        en: "Do you need vehicle pickup and drop service?",
        hi: "क्या आपको वाहन पिकअप और ड्रॉप सेवा चाहिए?",
        ar: "هل تحتاج إلى خدمة استلام وتسليم السيارة؟",
      },
      dataField: "pickup_required",
      validationType: "selection",
      options: [
        { label: "Yes, both pickup & drop", value: "both", nextNodeId: "confirm_booking" },
        { label: "Pickup only", value: "pickup", nextNodeId: "confirm_booking" },
        { label: "Drop only", value: "drop", nextNodeId: "confirm_booking" },
        { label: "No, I'll bring it myself", value: "none", nextNodeId: "confirm_booking" },
      ],
      position: { x: 400, y: 1130 },
    },
    {
      id: "confirm_booking",
      type: "confirmation",
      label: "Confirm Booking",
      message: {
        en: "Great! Here's your booking summary:\n\n📋 **Name:** {{customer_name}}\n📱 **Phone:** {{phone_number}}\n🚗 **Vehicle:** {{vehicle_model}} ({{registration_number}})\n🔧 **Service:** {{service_type}}\n📅 **Date:** {{preferred_date}}\n🚚 **Pickup/Drop:** {{pickup_required}}\n\nShall I confirm this booking?",
        hi: "बढ़िया! यहां आपकी बुकिंग का सारांश है:\n\n📋 **नाम:** {{customer_name}}\n📱 **फोन:** {{phone_number}}\n🚗 **वाहन:** {{vehicle_model}}\n🔧 **सेवा:** {{service_type}}\n📅 **तारीख:** {{preferred_date}}\n\nक्या मैं इस बुकिंग की पुष्टि करूं?",
        ar: "رائع! ملخص حجزك:\n\n📋 **الاسم:** {{customer_name}}\n📱 **الهاتف:** {{phone_number}}\n🚗 **السيارة:** {{vehicle_model}}\n🔧 **الخدمة:** {{service_type}}\n📅 **التاريخ:** {{preferred_date}}\n\nهل أؤكد هذا الحجز؟",
      },
      validationType: "selection",
      options: [
        { label: "Yes, confirm!", value: "confirm", nextNodeId: "booking_complete" },
        { label: "No, start over", value: "restart", nextNodeId: "greeting" },
      ],
      position: { x: 400, y: 1220 },
    },
    {
      id: "booking_complete",
      type: "end",
      label: "Booking Complete",
      message: {
        en: "✅ Your service booking has been confirmed! Booking ID: {{booking_id}}\n\nWe'll send you a reminder before your appointment. Thank you!",
        hi: "✅ आपकी सेवा बुकिंग की पुष्टि हो गई है! बुकिंग आईडी: {{booking_id}}\n\nहम आपकी अपॉइंटमेंट से पहले रिमाइंडर भेजेंगे।",
        ar: "✅ تم تأكيد حجز الخدمة! رقم الحجز: {{booking_id}}\n\nسنرسل لك تذكيرًا قبل موعدك.",
      },
      position: { x: 400, y: 1310 },
      metadata: { action: "create_service_booking" },
    },
  ],
  connections: [
    { id: "c1", sourceId: "greeting", targetId: "ask_name" },
    { id: "c2", sourceId: "ask_name", targetId: "ask_phone" },
    { id: "c3", sourceId: "ask_phone", targetId: "ask_vehicle_type" },
    { id: "c4", sourceId: "ask_vehicle_type", targetId: "ask_vehicle_model" },
    { id: "c5", sourceId: "ask_vehicle_model", targetId: "ask_registration" },
    { id: "c6", sourceId: "ask_registration", targetId: "ask_kms" },
    { id: "c7", sourceId: "ask_kms", targetId: "ask_service_type" },
    { id: "c8", sourceId: "ask_service_type", targetId: "ask_issue" },
    { id: "c9", sourceId: "ask_issue", targetId: "ask_date" },
    { id: "c10", sourceId: "ask_date", targetId: "check_slots" },
    { id: "c11", sourceId: "check_slots", targetId: "slot_decision" },
    { id: "c12", sourceId: "slot_decision", targetId: "ask_pickup", label: "Available" },
    { id: "c13", sourceId: "slot_decision", targetId: "suggest_alternative", label: "Full" },
    { id: "c14", sourceId: "suggest_alternative", targetId: "ask_pickup", label: "Yes" },
    { id: "c15", sourceId: "suggest_alternative", targetId: "ask_date", label: "Choose another" },
    { id: "c16", sourceId: "ask_pickup", targetId: "confirm_booking" },
    { id: "c17", sourceId: "confirm_booking", targetId: "booking_complete", label: "Confirm" },
    { id: "c18", sourceId: "confirm_booking", targetId: "greeting", label: "Restart" },
  ],
};

export const TEST_DRIVE_FLOW: FlowData = {
  version: 1,
  startNodeId: "td_greeting",
  nodes: [
    {
      id: "td_greeting",
      type: "greeting",
      label: "Greeting",
      message: {
        en: "🚗 Welcome! I'll help you book a test drive. Let's find the perfect car for you!",
        hi: "🚗 स्वागत है! मैं आपको टेस्ट ड्राइव बुक करने में मदद करूंगा।",
        ar: "🚗 مرحبًا! سأساعدك في حجز تجربة قيادة.",
      },
      nextNodeId: "td_ask_name",
      position: { x: 400, y: 50 },
    },
    {
      id: "td_ask_name",
      type: "question",
      label: "Ask Name",
      message: { en: "What's your full name?", hi: "आपका पूरा नाम क्या है?", ar: "ما هو اسمك الكامل؟" },
      dataField: "customer_name",
      validationType: "text",
      nextNodeId: "td_ask_phone",
      position: { x: 400, y: 140 },
    },
    {
      id: "td_ask_phone",
      type: "question",
      label: "Ask Phone",
      message: { en: "Your phone number?", hi: "आपका फोन नंबर?", ar: "رقم هاتفك؟" },
      dataField: "phone_number",
      validationType: "phone",
      nextNodeId: "td_ask_email",
      position: { x: 400, y: 230 },
    },
    {
      id: "td_ask_email",
      type: "question",
      label: "Ask Email",
      message: { en: "Your email address?", hi: "आपका ईमेल पता?", ar: "عنوان بريدك الإلكتروني؟" },
      dataField: "email",
      validationType: "email",
      nextNodeId: "td_ask_model",
      position: { x: 400, y: 320 },
    },
    {
      id: "td_ask_model",
      type: "question",
      label: "Ask Vehicle Interest",
      message: {
        en: "Which vehicle are you interested in test driving?",
        hi: "आप किस वाहन की टेस्ट ड्राइव में रुचि रखते हैं?",
        ar: "أي سيارة تريد تجربة قيادتها؟",
      },
      dataField: "vehicle_model",
      validationType: "text",
      nextNodeId: "td_ask_date",
      position: { x: 400, y: 410 },
    },
    {
      id: "td_ask_date",
      type: "question",
      label: "Ask Preferred Date",
      message: { en: "When would you like to schedule the test drive? (e.g., 2025-01-15)", hi: "आप टेस्ट ड्राइव कब शेड्यूल करना चाहेंगे?", ar: "متى تريد جدولة تجربة القيادة؟" },
      dataField: "preferred_date",
      validationType: "date",
      nextNodeId: "td_ask_time",
      position: { x: 400, y: 500 },
    },
    {
      id: "td_ask_time",
      type: "question",
      label: "Ask Preferred Time",
      message: { en: "What time works best for you?", hi: "आपके लिए कौन सा समय सबसे अच्छा है?", ar: "ما هو الوقت الأنسب لك؟" },
      dataField: "preferred_time",
      validationType: "selection",
      options: [
        { label: "Morning (9-12)", value: "morning", nextNodeId: "td_confirm" },
        { label: "Afternoon (12-3)", value: "afternoon", nextNodeId: "td_confirm" },
        { label: "Evening (3-6)", value: "evening", nextNodeId: "td_confirm" },
      ],
      position: { x: 400, y: 590 },
    },
    {
      id: "td_confirm",
      type: "confirmation",
      label: "Confirm Test Drive",
      message: {
        en: "Here's your test drive summary:\n\n👤 **Name:** {{customer_name}}\n📱 **Phone:** {{phone_number}}\n🚗 **Vehicle:** {{vehicle_model}}\n📅 **Date:** {{preferred_date}}\n⏰ **Time:** {{preferred_time}}\n\nConfirm?",
        hi: "आपकी टेस्ट ड्राइव का सारांश:\n\n👤 **नाम:** {{customer_name}}\n🚗 **वाहन:** {{vehicle_model}}\n📅 **तारीख:** {{preferred_date}}\n\nपुष्टि करें?",
        ar: "ملخص تجربة القيادة:\n\n👤 **الاسم:** {{customer_name}}\n🚗 **السيارة:** {{vehicle_model}}\n📅 **التاريخ:** {{preferred_date}}\n\nتأكيد؟",
      },
      validationType: "selection",
      options: [
        { label: "Yes, book it!", value: "confirm", nextNodeId: "td_complete" },
        { label: "Start over", value: "restart", nextNodeId: "td_greeting" },
      ],
      position: { x: 400, y: 680 },
    },
    {
      id: "td_complete",
      type: "end",
      label: "Test Drive Booked",
      message: {
        en: "✅ Your test drive is confirmed! We'll contact you to finalize details. See you soon!",
        hi: "✅ आपकी टेस्ट ड्राइव की पुष्टि हो गई! हम विवरण के लिए संपर्क करेंगे।",
        ar: "✅ تم تأكيد تجربة القيادة! سنتواصل معك لتأكيد التفاصيل.",
      },
      position: { x: 400, y: 770 },
      metadata: { action: "create_test_drive_booking" },
    },
  ],
  connections: [
    { id: "td_c1", sourceId: "td_greeting", targetId: "td_ask_name" },
    { id: "td_c2", sourceId: "td_ask_name", targetId: "td_ask_phone" },
    { id: "td_c3", sourceId: "td_ask_phone", targetId: "td_ask_email" },
    { id: "td_c4", sourceId: "td_ask_email", targetId: "td_ask_model" },
    { id: "td_c5", sourceId: "td_ask_model", targetId: "td_ask_date" },
    { id: "td_c6", sourceId: "td_ask_date", targetId: "td_ask_time" },
    { id: "td_c7", sourceId: "td_ask_time", targetId: "td_confirm" },
    { id: "td_c8", sourceId: "td_confirm", targetId: "td_complete", label: "Confirm" },
    { id: "td_c9", sourceId: "td_confirm", targetId: "td_greeting", label: "Restart" },
  ],
};

// Node type display config
export const NODE_TYPE_CONFIG: Record<NodeType, { color: string; icon: string; label: string }> = {
  greeting: { color: "hsl(var(--success))", icon: "👋", label: "Greeting" },
  question: { color: "hsl(var(--primary))", icon: "❓", label: "Question" },
  date_buttons: { color: "hsl(var(--primary))", icon: "📅", label: "Date Picker" },
  api_check: { color: "hsl(var(--info))", icon: "🔍", label: "API Check" },
  condition: { color: "hsl(var(--warning))", icon: "🔀", label: "Condition" },
  action: { color: "hsl(var(--accent))", icon: "⚡", label: "Action" },
  confirmation: { color: "hsl(var(--info))", icon: "✅", label: "Confirmation" },
  end: { color: "hsl(var(--destructive))", icon: "🏁", label: "End" },
};

// Helper to create a blank node of a given type
export function createBlankNode(type: NodeType, position: FlowNodePosition): FlowNode {
  const id = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const base: FlowNode = {
    id,
    type,
    label: NODE_TYPE_CONFIG[type].label,
    message: { en: "", hi: "", ar: "" },
    position,
  };
  if (type === "question") {
    base.message.en = "Please share the information.";
    base.validationType = "text";
    base.dataField = "";
  } else if (type === "date_buttons") {
    base.message.en = "Pick your preferred date:";
    base.validationType = "date";
    base.dataField = "preferred_date";
  } else if (type === "greeting") {
    base.message.en = "👋 Hello! How can I help you today?";
  } else if (type === "confirmation") {
    base.message.en = "Please confirm the details above.";
    base.validationType = "selection";
    base.options = [
      { label: "Yes, confirm", value: "confirm", nextNodeId: "" },
      { label: "Start over", value: "restart", nextNodeId: "" },
    ];
  } else if (type === "end") {
    base.message.en = "✅ All done. Thank you!";
  }
  return base;
}
