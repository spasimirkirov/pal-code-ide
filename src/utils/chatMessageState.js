export const updateMessageById = (messages, messageId, updater) =>
    messages.map((message) => (message.id === messageId ? updater(message) : message));

export const finishMessageById = (messages, messageId) =>
    updateMessageById(messages, messageId, (message) => ({
        ...message,
        status: 'done',
    }));

export const upsertExecutionStepInMessage = (messages, messageId, stepUpdate) => {
    const stepKey = `${String(stepUpdate?.type || 'read')}:${String(stepUpdate?.target || '').trim()}`;

    return updateMessageById(messages, messageId, (message) => {
        const steps = Array.isArray(message.executionSteps) ? [...message.executionSteps] : [];
        const nextStep = {
            key: stepKey,
            type: String(stepUpdate?.type || 'read'),
            status: String(stepUpdate?.status || 'pending'),
            target: String(stepUpdate?.target || ''),
            details: String(stepUpdate?.details || ''),
            updatedAt: Date.now(),
        };

        const existingIndex = steps.findIndex((item) => item?.key === stepKey);
        if (existingIndex >= 0) {
            steps[existingIndex] = {
                ...steps[existingIndex],
                ...nextStep,
            };
        } else {
            steps.push(nextStep);
        }

        return {
            ...message,
            executionSteps: steps,
        };
    });
};
