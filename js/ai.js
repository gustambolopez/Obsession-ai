const API_KEYS_URL = "https://groq-api-keys.pages.dev/apikeys.txt";
let apiKeys = [];
let apiKeyIndex = parseInt(localStorage.getItem("apiKeyIndex") || "-1", 10);
let isFetching = false;
let abortController = null;
let isTyping = false;
let currentTypingFinish = null;
let autoSpeak = false;

let messageHistory = [];

const chatBody = document.getElementById("chatBody");
const branding = document.querySelector(".branding");
const aiInput = document.getElementById("aiInput");
const sendMsg = document.getElementById("sendMsg");
const modelSelector = document.getElementById("modelSelector");
const modelSelected = modelSelector.querySelector(".selector-selected");
const modelOptions = modelSelector.querySelector(".selector-options");
let modelSourceValue = localStorage.getItem("selectedModel") || "llama-3.1-8b-instant";
const modelDisplayNames = {
    "llama-3.1-8b-instant": "Llama 3.1 8B Instant",
    "llama-3-70b-8192": "Llama 3 70B",
    "deepseek-r1-distill-llama-70b": "Deepseek R1 Distill Llama 70B",
    "gemma2-9b-it": "Gemma2 9B IT",
};


async function fetchApiKeys() {
    try {
        const response = await fetch(API_KEYS_URL);
        if (!response.ok) throw new Error("Network response was not ok.");
        const text = await response.text();
        apiKeys = text.split('\n').map(key => key.trim()).filter(key => key.length > 0);
        if (apiKeys.length === 0) throw new Error("No API keys found.");

        if (apiKeyIndex === -1 || apiKeyIndex >= apiKeys.length) {
            apiKeyIndex = 0;
            localStorage.setItem("apiKeyIndex", apiKeyIndex.toString());
        }
    } catch (error) {
        console.error("Error fetching API keys:", error);
        showToast("Error loading API keys. Please try again later.", "error");
        apiKeys = [];
    }
}

function showToast(message, type = "info", duration = 3000) {
    const toastContainer = document.querySelector(".toast-container") || (() => {
        const div = document.createElement("div");
        div.className = "toast-container";
        document.body.appendChild(div);
        return div;
    })();

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("show");
    }, 10);

    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => toast.remove());
    }, duration);
}

function displayMessage(content, sender, image = null) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", `${sender}-message`);

    if (image) {
        const imgElement = document.createElement("img");
        imgElement.src = image;
        imgElement.classList.add("message-image");
        messageElement.appendChild(imgElement);
    }

    const textElement = document.createElement("div");
    textElement.classList.add("message-text");
    textElement.innerHTML = marked.parse(content);

    messageElement.appendChild(textElement);
    chatBody.appendChild(messageElement);
    chatBody.scrollTop = chatBody.scrollHeight;

    if (sender === 'ai') {
        const codeBlocks = messageElement.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            const lang = block.className.match(/language-(\w+)/);
            const language = lang ? lang[1] : 'plaintext';

            const codeBlockWrapper = document.createElement('div');
            codeBlockWrapper.classList.add('code-block');

            const langLabel = document.createElement('span');
            langLabel.classList.add('code-lang');
            langLabel.textContent = language;
            codeBlockWrapper.appendChild(langLabel);

            const copyButton = document.createElement('button');
            copyButton.classList.add('ai-button', 'copy-button');
            copyButton.innerHTML = '<i class="ri-file-copy-line"></i>';
            copyButton.title = 'Copy code';
            copyButton.onclick = () => copyCode(block.textContent, copyButton);

            const regenerateButton = document.createElement('button');
            regenerateButton.classList.add('ai-button', 'regenerate-button');
            regenerateButton.innerHTML = '<i class="ri-refresh-line"></i>';
            regenerateButton.title = 'Regenerate';
            regenerateButton.onclick = () => regenerateResponse(content);

            const aiButtons = document.createElement('div');
            aiButtons.classList.add('ai-buttons');
            aiButtons.appendChild(copyButton);
            aiButtons.appendChild(regenerateButton);

            codeBlockWrapper.appendChild(block.parentNode);
            codeBlockWrapper.appendChild(aiButtons);
            messageElement.replaceChild(codeBlockWrapper, textElement);
        });
        hljs.highlightAll();
    }
}

function addThinkingIndicator() {
    const thinkingElement = document.createElement("div");
    thinkingElement.classList.add("message", "ai-message", "thinking-indicator");
    thinkingElement.innerHTML = `
        <div class="message-text">Thinking<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>
    `;
    chatBody.appendChild(thinkingElement);
    chatBody.scrollTop = chatBody.scrollHeight;
    isTyping = true;
    currentTypingFinish = new Promise(resolve => thinkingElement.resolveTyping = resolve);
}

function removeThinkingIndicator() {
    const thinkingElement = chatBody.querySelector(".thinking-indicator");
    if (thinkingElement) {
        thinkingElement.resolveTyping();
        thinkingElement.remove();
    }
    isTyping = false;
    currentTypingFinish = null;
}

async function sendMessage(text, image = null) {
    if (isFetching) {
        abortController.abort();
        isFetching = false;
        sendMsg.innerHTML = '<i class="fas fa-arrow-up"></i>';
        removeThinkingIndicator();
        showToast("Request aborted.", "info");
        return;
    }

    if (!text.trim() && !image) return;

    messageHistory.push({ role: "user", content: text, image: image });
    displayMessage(text, "user", image);
    aiInput.value = "";
    branding.style.display = "none";
    sendMsg.innerHTML = '<i class="fas fa-stop"></i>';
    sendMsg.classList.add("red");

    addThinkingIndicator();
    isFetching = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
        if (apiKeys.length === 0) {
            await fetchApiKeys();
            if (apiKeys.length === 0) {
                throw new Error("No valid API keys available.");
            }
        }

        const currentApiKey = apiKeys[apiKeyIndex];
        const requestBody = {
            model: modelSourceValue,
            messages: messageHistory.map(msg => ({ role: msg.role, content: msg.content })),
            temperature: 0.7,
            max_tokens: 1024,
            stream: true,
        };

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentApiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: signal,
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (response.status === 401) {
                showToast("API key invalid or expired. Trying next key...", "error");
                apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;
                localStorage.setItem("apiKeyIndex", apiKeyIndex.toString());
                isFetching = false;
                sendMsg.innerHTML = '<i class="fas fa-arrow-up"></i>';
                sendMsg.classList.remove("red");
                removeThinkingIndicator();
                sendMessage(text, image);
                return;
            } else if (response.status === 429) {
                showToast("Rate limit exceeded. Trying next key...", "warning");
                apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;
                localStorage.setItem("apiKeyIndex", apiKeyIndex.toString());
                isFetching = false;
                sendMsg.innerHTML = '<i class="fas fa-arrow-up"></i>';
                sendMsg.classList.remove("red");
                removeThinkingIndicator();
                sendMessage(text, image);
                return;
            }
            throw new Error(`API error: ${errorData.message || response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let aiResponseContent = "";
        let buffer = "";

        removeThinkingIndicator();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith("data:")) {
                    const jsonStr = line.substring(5).trim();
                    if (jsonStr === "[DONE]") {
                        if (currentTypingFinish) currentTypingFinish();
                        break;
                    }
                    try {
                        const data = JSON.parse(jsonStr);
                        if (data.choices && data.choices.length > 0 && data.choices[0].delta && data.choices[0].delta.content) {
                            aiResponseContent += data.choices[0].delta.content;

                            const lastMessageElement = chatBody.lastChild;
                            if (lastMessageElement && lastMessageElement.classList.contains('ai-message') && !lastMessageElement.classList.contains('thinking-indicator')) {
                                lastMessageElement.querySelector('.message-text').innerHTML = marked.parse(aiResponseContent);
                            } else {
                                displayMessage(aiResponseContent, "ai");
                            }
                            chatBody.scrollTop = chatBody.scrollHeight;
                        }
                    } catch (e) {
                        console.warn("Could not parse JSON from stream:", e, jsonStr);
                    }
                }
            }
        }
        if (aiResponseContent.trim()) {
            messageHistory.push({ role: "assistant", content: aiResponseContent });
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log("Fetch aborted");
            showToast("Request canceled.", "info");
        } else {
            console.error("Error fetching AI response:", error);
            displayMessage(`An error occurred: ${error.message}`, "ai");
            messageHistory.push({ role: "assistant", content: `An error occurred: ${error.message}` });
        }
    } finally {
        isFetching = false;
        sendMsg.innerHTML = '<i class="fas fa-arrow-up"></i>';
        sendMsg.classList.remove("red");
        removeThinkingIndicator();
        updateSuggestions(aiInput.value);
    }
}

function regenerateResponse(lastContent) {
    if (isFetching) {
        showToast("Please wait for the current response to finish or cancel it.", "warning");
        return;
    }

    if (messageHistory.length < 2) {
        showToast("No previous AI message to regenerate.", "info");
        return;
    }

    if (messageHistory[messageHistory.length - 1].role === 'assistant') {
        messageHistory.pop();
    }

    const lastUserMessage = messageHistory.findLast(msg => msg.role === 'user');
    if (lastUserMessage) {
        const lastUserMessageContent = lastUserMessage.content;
        const lastUserMessageImage = lastUserMessage.image;

        chatBody.removeChild(chatBody.lastChild);
        if (chatBody.lastChild && chatBody.lastChild.classList.contains('user-message') && chatBody.lastChild.textContent.trim() === lastUserMessageContent.trim()) {
            // This block is empty, it seems to imply no action needed if the last message is already the user's
        } else {
            displayMessage(lastUserMessageContent, 'user', lastUserMessageImage);
        }

        sendMessage(lastUserMessageContent, lastUserMessageImage);
    } else {
        showToast("No user message to regenerate from.", "info");
    }
}

function copyCode(code, button) {
    navigator.clipboard.writeText(code).then(() => {
        button.innerHTML = '<i class="ri-check-line"></i>';
        setTimeout(() => {
            button.innerHTML = '<i class="ri-file-copy-line"></i>';
        }, 2000);
    }).catch(err => {
        console.error('Error copying text: ', err);
        showToast("Failed to copy code.", "error");
    });
}

function updateSuggestions(inputText) {
    const suggestionsContainer = document.getElementById("suggestionsContainer");
    suggestionsContainer.innerHTML = '';

    if (inputText.length === 0) {
        const commonSuggestions = [
            "Explain JavaScript closures",
            "What is quantum computing?",
            "How to make a responsive website?",
            "Tell me a fun fact about space"
        ];
        commonSuggestions.forEach(s => {
            const suggestionDiv = document.createElement("div");
            suggestionDiv.classList.add("suggestion");
            suggestionDiv.textContent = s;
            suggestionDiv.addEventListener("click", () => {
                aiInput.value = s;
                sendMsg.click();
            });
            suggestionsContainer.appendChild(suggestionDiv);
        });
        suggestionsContainer.style.display = "flex";
        branding.style.display = "flex";
    } else {
        suggestionsContainer.style.display = "none";
    }
}



document.addEventListener("DOMContentLoaded", async () => {
    await fetchApiKeys();


    modelSelected.textContent = modelDisplayNames[modelSourceValue];
    updateSuggestions("");

    modelSelected.addEventListener("click", () => {
        modelOptions.classList.toggle("show");
        modelSelected.classList.toggle("active");
    });

    modelOptions.querySelectorAll("div").forEach(option => {
        option.addEventListener("click", () => {
            modelSourceValue = option.dataset.value;
            modelSelected.textContent = option.textContent;
            localStorage.setItem("selectedModel", modelSourceValue);
            modelOptions.classList.remove("show");
            modelSelected.classList.remove("active");
        });
    });

    document.addEventListener("click", (e) => {
        if (!modelSelector.contains(e.target)) {
            modelOptions.classList.remove("show");
            modelSelected.classList.remove("active");
        }
    });

    aiInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendMsg.click();
        }
    });

    sendMsg.addEventListener("click", () => sendMessage(aiInput.value));

    aiInput.addEventListener("input", () => updateSuggestions(aiInput.value));

    updateSuggestions(""); 
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { };
});
