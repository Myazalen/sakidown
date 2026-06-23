/**
 * @file settings/strategies.js
 * @description 策略数据模型与常量定义 (Strategy Data Model)
 * * @author weiyunjun
 * @version v0.2.0 (纯音频定制版)
 */

const STRATEGY_CONSTANTS = { DEFAULT_ID: 'default-audio-only', STORAGE_KEY: 'downloadStrategies' };

const NAME_CONSTRAINTS = { MAX_LENGTH: 30 };

const DEFAULT_STRATEGIES = [
    {
        id: 'default-audio-only',
        name: '纯音频',
        description: '',
        isSystem: true,
        config: {
            audio: true,
            video: false,
            quality: { primary: 'best', secondary: 'dolby' },
            codec: { primary: 'av1', secondary: 'hevc' },
            merge: false,
            cover: false,
            danmaku: false,
        },
    },
];

const STRATEGY_SCHEMA = [
    {
        type: 'section',
        title: '基础信息',
        children: [
            {
                key: 'name',
                type: 'text',
                label: '策略名称',
                placeholder: '请输入策略名称',
                width: '100%',
                layout: 'vertical'
            }
        ]
    },
    {
        type: 'section',
        title: '附件下载',
        children: [
            {
                key: 'config.cover',
                type: 'select',
                label: '封面',
                options: [
                    { value: '', label: '不下载' },
                    { value: 'jpg', label: 'JPG封面' },
                ],
                layout: 'between',
                toView: (v) => (typeof v === 'string') ? v : '',
                toModel: (v) => v || false,
            },
            {
                key: 'config.danmaku',
                type: 'select',
                label: '弹幕',
                options: [
                    { value: '', label: '不下载' },
                    { value: 'xml', label: 'XML弹幕' },
                    { value: 'ass', label: 'ASS弹幕' },
                ],
                layout: 'between',
                toView: (v) => (typeof v === 'string') ? v : '',
                toModel: (v) => v || false,
            }
        ]
    }
];

function validatestrategy_config(config) {
    if (!config) return false;
    return config.audio === true || !!config.cover || !!config.danmaku;
}

function validateStrategyName(name) {
    if (!name || typeof name !== 'string') return { valid: false, msg: '名称不能为空' };
    const trimmed = name.trim();

    if (trimmed.length === 0) return { valid: false, msg: '名称不能为空' };
    let charLength = 0;

    for (let i = 0; i < trimmed.length; i++) {
        charLength += trimmed.charCodeAt(i) > 127 ? 2 : 1;
    }

    if (charLength > NAME_CONSTRAINTS.MAX_LENGTH) {
        return { valid: false, msg: `名称不能超过 ${NAME_CONSTRAINTS.MAX_LENGTH} 个字符 (当前: ${charLength})` };
    }

    const illegalRegex = /[\\/:*?"<>|]/;

    if (illegalRegex.test(trimmed)) {
        return { valid: false, msg: '名称包含非法字符 (\\ / : * ? " < > |)' };
    }

    return { valid: true, name: trimmed };
}

function createNewStrategy() {
    return {
        id: 'custom-' + Date.now(),
        name: '',
        description: '',
        isSystem: false,
        config: {
            audio: true,
            video: false,
            quality: { primary: 'best', secondary: 'dolby' },
            codec: { primary: 'av1', secondary: 'hevc' },
            merge: false,
            cover: false,
            danmaku: false,
        },
    };
}

window.Strategies = {
    STRATEGY_CONSTANTS: STRATEGY_CONSTANTS,
    DEFAULT_STRATEGIES: DEFAULT_STRATEGIES,
    NAME_CONSTRAINTS: NAME_CONSTRAINTS,
    validatestrategy_config: validatestrategy_config,
    validateStrategyName: validateStrategyName,
    canMerge: () => false,
    createNewStrategy: createNewStrategy,
    STRATEGY_SCHEMA: STRATEGY_SCHEMA,
};