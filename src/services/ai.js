// 🤖 خدمة Claude AI
import { getSetting, getAISettings, getAIConversation, saveAIConversation, createAIOrder } from '../database/init.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// بناء System Prompt
function buildSystemPrompt(aiSettings) {
    let prompt = aiSettings.system_prompt || '';
    
    if (aiSettings.business_name) {
        prompt += `\n\nاسم النشاط التجاري: ${aiSettings.business_name}`;
    }
    
    if (aiSettings.business_type) {
        prompt += `\nنوع النشاط: ${aiSettings.business_type}`;
    }
    
    if (aiSettings.products) {
        prompt += `\n\nالمنتجات/الخدمات المتاحة:\n${aiSettings.products}`;
    }
    
    if (aiSettings.working_hours) {
        prompt += `\n\nساعات العمل: ${aiSettings.working_hours}`;
    }
    
    // إضافة تعليمات للطلبات والحجوزات
    prompt += `

تعليمات مهمة:
- أنت مساعد ذكي لخدمة العملاء
- كن ودوداً ومهنياً في الردود
- إذا أراد العميل حجز موعد أو طلب منتج، اجمع المعلومات التالية:
  * اسم العميل
  * رقم الهاتف (إذا مختلف)
  * تفاصيل الطلب أو الموعد المطلوب
- عند اكتمال جمع المعلومات، أرسل رسالة تأكيد للعميل
- إذا كان الطلب جاهز للتأكيد، أضف في نهاية ردك:
  [ORDER_READY]
  type: order أو appointment
  name: اسم العميل
  details: تفاصيل الطلب
  [/ORDER_READY]
`;
    
    return prompt;
}

// إرسال رسالة لـ Claude
export async function sendToClaudeAI(userId, phone, customerPhone, customerMessage, customerName = 'عميل') {
    const apiKey = getSetting('claude_api_key');
    const model = getSetting('claude_model') || 'claude-sonnet-4-20250514';
    
    if (!apiKey) {
        return { success: false, error: 'لم يتم تعيين مفتاح API' };
    }
    
    const aiSettings = getAISettings(userId, phone);
    if (!aiSettings || !aiSettings.is_enabled) {
        return { success: false, error: 'AI غير مفعل لهذا الحساب' };
    }
    
    // جلب المحادثة السابقة
    let conversation = getAIConversation(userId, phone, customerPhone);
    let messages = conversation?.messages || [];
    
    // إضافة رسالة العميل
    messages.push({
        role: 'user',
        content: customerMessage
    });
    
    // الاحتفاظ بآخر 20 رسالة فقط
    if (messages.length > 20) {
        messages = messages.slice(-20);
    }
    
    try {
        const response = await fetch(CLAUDE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 1024,
                system: buildSystemPrompt(aiSettings),
                messages: messages
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            console.error('Claude API Error:', error);
            return { success: false, error: 'خطأ في API' };
        }
        
        const data = await response.json();
        const aiResponse = data.content[0].text;
        
        // إضافة رد AI للمحادثة
        messages.push({
            role: 'assistant',
            content: aiResponse
        });
        
        // حفظ المحادثة
        saveAIConversation(userId, phone, customerPhone, messages);
        
        // التحقق من وجود طلب جاهز
        let order = null;
        const orderMatch = aiResponse.match(/\[ORDER_READY\]([\s\S]*?)\[\/ORDER_READY\]/);
        if (orderMatch) {
            const orderData = orderMatch[1];
            const typeMatch = orderData.match(/type:\s*(.+)/);
            const nameMatch = orderData.match(/name:\s*(.+)/);
            const detailsMatch = orderData.match(/details:\s*(.+)/);
            
            if (typeMatch && detailsMatch) {
                order = {
                    type: typeMatch[1].trim(),
                    name: nameMatch ? nameMatch[1].trim() : customerName,
                    details: detailsMatch[1].trim()
                };
                
                // إنشاء الطلب في قاعدة البيانات
                const orderId = createAIOrder(
                    userId, 
                    phone, 
                    customerPhone, 
                    order.name, 
                    order.type, 
                    { details: order.details }
                );
                order.id = orderId;
            }
        }
        
        // إزالة علامات الطلب من الرد
        const cleanResponse = aiResponse.replace(/\[ORDER_READY\][\s\S]*?\[\/ORDER_READY\]/, '').trim();
        
        return { 
            success: true, 
            response: cleanResponse,
            order: order
        };
        
    } catch (error) {
        console.error('Claude AI Error:', error);
        return { success: false, error: error.message };
    }
}

// الحصول على الموديلات المتاحة
export function getAvailableModels() {
    return [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (الأحدث)' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (سريع)' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (متقدم)' }
    ];
}
