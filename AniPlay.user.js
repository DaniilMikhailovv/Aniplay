// ==UserScript==
// @name         AniPlay
// @namespace    http://tampermonkey.net/
// @version      1.36
// @description  Панель управления для Adobe Animate баннеров
// @match        *://*/*
// @include      file:///*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Версия скрипта для логирования
    const SCRIPT_VERSION = '1.35';

    // Ждём появления createjs.Ticker и сохраняем FPS при старте
    function waitForCreatejsTickerAndInitPanel(maxWaitMs = 10000, intervalMs = 100) {
        const start = Date.now();
        (function check() {
            if (
                typeof createjs !== 'undefined' &&
                createjs.Ticker &&
                typeof createjs.Ticker.framerate === 'number' &&
                createjs.Ticker.framerate !== 20
            ) {
                const ORIGINAL_FPS = createjs.Ticker.framerate;
                console.log(`[Animate Panel] ORIGINAL_FPS при старте: ${ORIGINAL_FPS}`);
                initAnimatePanel(ORIGINAL_FPS);
            } else if (Date.now() - start < maxWaitMs) {
                setTimeout(check, intervalMs);
            } else {
                console.warn('[Animate Panel] createjs.Ticker.framerate не найден или не изменился с 20, панель не будет инициализирована');
            }
        })();
    }

    // Функция для управления шириной баннера
    function initBannerWidthControl() {
        // Проверяем наличие контейнера баннера
        const animationContainer = document.getElementById('animation_container');
        if (!animationContainer) {
            console.warn('[Banner Control] animation_container не найден');
            return;
        }

        // Заводим переменную-переключатель
        window.bannerWidthOverride = null;
        
        // Функция для сохранения настроек ширины
        function saveBannerWidthSettings(width, isActive) {
            try {
                localStorage.setItem('animateBannerWidth', width ? width.toString() : '');
                localStorage.setItem('animateBannerWidthActive', isActive ? 'true' : 'false');
                console.log(`[Banner Control] Сохранены настройки: ширина=${width}, активно=${isActive}`);
            } catch(e) {
                console.warn('[Banner Control] Ошибка при сохранении настроек ширины:', e);
            }
        }
        
        // Восстанавливаем сохраненные настройки
        let savedWidth = null;
        try {
            const savedWidthValue = localStorage.getItem('animateBannerWidth');
            if (savedWidthValue && !isNaN(savedWidthValue)) {
                savedWidth = parseInt(savedWidthValue);
                console.log(`[Banner Control] Восстановлена ширина: ${savedWidth}px`);
            }
        } catch(e) {
            console.warn('[Banner Control] Ошибка при чтении сохраненной ширины:', e);
        }
        
        // Восстанавливаем состояние активности
        let isWidthControlActive = false;
        try {
            isWidthControlActive = localStorage.getItem('animateBannerWidthActive') === 'true';
            console.log(`[Banner Control] Восстановлено состояние активности: ${isWidthControlActive}`);
        } catch(e) {
            console.warn('[Banner Control] Ошибка при чтении состояния активности:', e);
        }
        
        // Сохраняем исходную ширину баннера
        let originalWidth = null;
        
        // Сохраняем оригинальный дескриптор clientWidth
        let originalDescriptor;
        try {
            originalDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.documentElement), 'clientWidth');
        } catch (e) {
            console.warn('[Banner Control] Не удалось получить дескриптор свойства clientWidth:', e);
            originalDescriptor = null;
        }
        let isWidthOverridden = false;
        
        // Для блокировки переходов по ссылкам в баннере
        window.isBannerEditModeActive = false;
        
        // Функция для блокировки кликов по баннеру
        function blockBannerClicks() {
            if (!window.clickBlockerInstalled) {
                // Создаем функцию-обработчик
                window.bannerClickHandler = function(e) {
                    if (window.isBannerEditModeActive) {
                        // Блокируем переход по ссылкам внутри баннера
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[Banner Control] Клик по баннеру заблокирован');
                    }
                };
                
                // Находим все ссылки внутри баннера
                const bannerElement = document.getElementById('banner') || 
                                     document.querySelector('.banner') || 
                                     document.getElementById('animation_container');
                
                if (bannerElement) {
                    // Добавляем обработчик на уровень баннера для перехвата всех кликов
                    bannerElement.addEventListener('click', window.bannerClickHandler, true);
                    
                    // Для надежности - обработчик на уровне document
                    document.addEventListener('click', function(e) {
                        if (window.isBannerEditModeActive) {
                            // Проверяем, находится ли клик внутри баннера
                            let target = e.target;
                            while (target) {
                                if (target === bannerElement) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('[Banner Control] Клик по баннеру заблокирован (глубокий перехват)');
                                    return;
                                }
                                target = target.parentElement;
                            }
                        }
                    }, true);
                    
                    window.clickBlockerInstalled = true;
                    console.log('[Banner Control] Система блокировки кликов установлена');
                } else {
                    console.warn('[Banner Control] Не найден элемент баннера для блокировки кликов');
                }
            }
        }

        // Устанавливаем блокировщик кликов при инициализации
        blockBannerClicks();
        
        // Функция для переопределения clientWidth
        function overrideClientWidth() {
            if (isWidthOverridden) return;
            
            Object.defineProperty(document.documentElement, 'clientWidth', {
                get: function() {
                    return window.bannerWidthOverride !== null
                        ? window.bannerWidthOverride
                        : document.documentElement.getBoundingClientRect().width;
                },
                configurable: true
            });
            
            isWidthOverridden = true;
            console.log('[Banner Control] clientWidth переопределен');
        }
        
        // Функция для восстановления исходного clientWidth
        function restoreClientWidth() {
            if (!isWidthOverridden) return;
            
            // Удаляем переопределенное свойство
            delete document.documentElement.clientWidth;
            
            // Проверяем, был ли успешно сохранен оригинальный дескриптор
            if (originalDescriptor) {
                // Применяем оригинальный дескриптор
                Object.defineProperty(document.documentElement, 'clientWidth', originalDescriptor);
                console.log('[Banner Control] clientWidth восстановлен');
            } else {
                console.warn('[Banner Control] Невозможно восстановить оригинальный clientWidth');
            }
            
            isWidthOverridden = false;
        }

        // Создаём ползунок для изменения ширины
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, {
            position: 'absolute',
            right: '-10px',
            top: '0',
            width: '10px',
            height: '100%',
            cursor: 'ew-resize',
            background: 'rgba(0, 120, 255, 0.1)',
            zIndex: '9998',
            boxShadow: '0 0 2px rgba(0, 120, 255, 0.8)',
            transition: 'background 0.2s, opacity 0.3s',
            opacity: '0'  // Начальное состояние - скрыт
        });
        
        // Добавляем маркер-ручку для более удобного перетаскивания
        const dragHandle = document.createElement('div');
        Object.assign(dragHandle.style, {
            position: 'absolute',
            right: '0px',
            bottom: '-40px',
            width: 'auto',
            minWidth: '20px',
            height: '36px',
            background: 'rgba(80, 80, 80, 0.7)',
            borderRadius: '4px 0 0 4px',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
            zIndex: '9999',
            cursor: 'ew-resize',
            transition: 'background 0.2s, opacity 0.3s',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 8px',
            opacity: '0',  // Начальное состояние - скрыт
            gap: '4px'
        });

        // Создаём элемент для отображения ширины
        const widthInfo = document.createElement('div');
        Object.assign(widthInfo.style, {
            color: '#fff',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none'
        });

        // Функция обновления информации о ширине
        function updateWidthInfo() {
            const currentWidth = animationContainer.offsetWidth;
            widthInfo.textContent = `${currentWidth}px`;
        }

        // Обновляем информацию о ширине при изменении размера
        const resizeObserver = new ResizeObserver(() => {
            updateWidthInfo();
        });
        resizeObserver.observe(animationContainer);

        // Добавляем внутренние полоски для визуального оформления маркера
        const handleLines = document.createElement('div');
        Object.assign(handleLines.style, {
            width: '8px',
            height: '18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flexShrink: 0
        });
        
        // Создаем три полоски внутри маркера
        for (let i = 0; i < 3; i++) {
            const line = document.createElement('div');
            Object.assign(line.style, {
                height: '2px',
                background: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '1px'
            });
            handleLines.appendChild(line);
        }
        
        // Добавляем элементы в маркер
        dragHandle.appendChild(widthInfo);
        dragHandle.appendChild(handleLines);
        
        // Инициализируем информацию о ширине
        updateWidthInfo();
        
        // Добавляем эффект при наведении
        dragHandle.addEventListener('mouseenter', () => {
            if (isWidthControlActive) {
                dragHandle.style.background = 'rgba(80, 80, 80, 0.9)';
            }
        });
        
        dragHandle.addEventListener('mouseleave', () => {
            if (isWidthControlActive) {
                dragHandle.style.background = 'rgba(80, 80, 80, 0.7)';
            }
        });
        
        // Добавляем эффект при наведении
        resizeHandle.addEventListener('mouseenter', () => {
            if (isWidthControlActive) {
                resizeHandle.style.background = 'rgba(0, 120, 255, 0.3)';
                dragHandle.style.background = 'rgba(80, 80, 80, 0.9)';
            }
        });
        
        resizeHandle.addEventListener('mouseleave', () => {
            if (isWidthControlActive) {
                resizeHandle.style.background = 'rgba(0, 120, 255, 0.1)';
                if (!dragHandle.matches(':hover')) {
                    dragHandle.style.background = 'rgba(80, 80, 80, 0.7)';
                }
            }
        });
        
        // Добавляем обработчик двойного клика для ручного ввода ширины
        function handleManualWidthInput() {
            if (!isWidthControlActive) return;
            
            // Получаем текущую ширину баннера
            const currentWidth = animationContainer.offsetWidth;
            
            // Показываем диалоговое окно для ввода новой ширины
            const newWidth = prompt(`Введите новую ширину баннера (текущая: ${currentWidth}px):`, currentWidth);
            
            // Проверяем введенное значение
            if (newWidth !== null && !isNaN(newWidth) && parseInt(newWidth) > 0) {
                // Устанавливаем минимальную ширину
                const width = Math.max(200, parseInt(newWidth));
                
                // Изменяем ширину контейнера
                animationContainer.style.width = `${width}px`;
                
                // Изменяем ширину canvas и dom_overlay_container
                const canvas = document.getElementById('canvas');
                const domOverlayContainer = document.getElementById('dom_overlay_container');
                
                if (canvas) canvas.style.width = `${width}px`;
                if (domOverlayContainer) domOverlayContainer.style.width = `${width}px`;
                
                // Устанавливаем значение для переопределения clientWidth
                window.bannerWidthOverride = width;
                
                // Вызываем событие resize для обновления баннера
                window.dispatchEvent(new Event('resize'));
                
                // Сохраняем новую ширину в localStorage
                saveBannerWidthSettings(width, isWidthControlActive);
            }
        }
        
        // Добавляем обработчики двойного клика для обоих элементов
        resizeHandle.addEventListener('dblclick', handleManualWidthInput);
        dragHandle.addEventListener('dblclick', handleManualWidthInput);

        // Логика перетаскивания (добавляем обработчик и для маркера)
        let isDragging = false;
        let startX, startWidth;

        function startDrag(e) {
            if (!isWidthControlActive) return;
            isDragging = true;
            startX = e.clientX;
            startWidth = animationContainer.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        }

        resizeHandle.addEventListener('mousedown', startDrag);
        dragHandle.addEventListener('mousedown', startDrag);

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            // Вычисляем новую ширину
            const newWidth = startWidth + (e.clientX - startX);
            
            // Устанавливаем минимальную ширину
            const width = Math.max(200, newWidth);
            
            // Изменяем ширину контейнера
            animationContainer.style.width = `${width}px`;
            
            // Изменяем ширину canvas и dom_overlay_container
            const canvas = document.getElementById('canvas');
            const domOverlayContainer = document.getElementById('dom_overlay_container');
            
            if (canvas) canvas.style.width = `${width}px`;
            if (domOverlayContainer) domOverlayContainer.style.width = `${width}px`;
            
            // Устанавливаем значение для переопределения clientWidth
            window.bannerWidthOverride = width;
            
            // Вызываем событие resize для обновления баннера
            window.dispatchEvent(new Event('resize'));
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                // Сохраняем текущую ширину при завершении перетаскивания
                saveBannerWidthSettings(window.bannerWidthOverride, isWidthControlActive);
                
                isDragging = false;
                document.body.style.cursor = '';
            }
        });

        // Функция для создания кнопки управления шириной
        function createWidthControlButton(scaleBox) {
            // Создаём контейнер для кнопки
            const widthControlContainer = document.createElement('div');
            Object.assign(widthControlContainer.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                margin: '8px 0 0 0',
                alignSelf: 'center'
            });

            const widthControlBtn = document.createElement('button');
            widthControlBtn.title = 'Включить/выключить изменение ширины баннера';
            widthControlBtn.innerHTML = '<span class="material-icons" style="font-size:28px;">swap_horiz</span>';
            Object.assign(widthControlBtn.style, {
                width: '44px', 
                height: '44px',
                borderRadius: '8px',
                border: 'none', 
                background: 'rgba(0,0,0,0.5)', 
                color: '#fff', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '0', 
                boxShadow: '0 2px 8px rgba(0,0,0,0.13)', 
                transition: 'background 0.18s, box-shadow 0.18s'
            });
            
            widthControlBtn.addEventListener('mouseenter', () => { 
                widthControlBtn.style.background = 'rgba(255,255,255,0.2)'; 
            });
            
            widthControlBtn.addEventListener('mouseleave', () => { 
                widthControlBtn.style.background = isWidthControlActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)'; 
            });
            
            widthControlBtn.addEventListener('mousedown', () => { 
                widthControlBtn.style.background = 'rgba(255,255,255,0.32)'; 
            });
            
            widthControlBtn.addEventListener('mouseup', () => { 
                widthControlBtn.style.background = 'rgba(255,255,255,0.2)'; 
            });
            
            // Обработчик клика для включения/выключения режима изменения ширины
            widthControlBtn.addEventListener('click', () => {
                isWidthControlActive = !isWidthControlActive;
                
                // Обновляем глобальное состояние режима изменения ширины
                window.isWidthControlActive = isWidthControlActive;
                
                // Обновляем глобальное состояние режима редактирования баннера
                window.isBannerEditModeActive = isWidthControlActive || 
                    (window.isRulersActive === true);
                
                if (isWidthControlActive) {
                    // Активируем режим изменения ширины
                    
                    // Сохраняем исходный размер при активации
                    if (originalWidth === null) {
                        originalWidth = animationContainer.offsetWidth;
                    }
                    
                    // Если есть сохраненная ширина, применяем её
                    if (savedWidth !== null && savedWidth >= 200) {
                        animationContainer.style.width = `${savedWidth}px`;
                        
                        const canvas = document.getElementById('canvas');
                        const domOverlayContainer = document.getElementById('dom_overlay_container');
                        
                        if (canvas) canvas.style.width = `${savedWidth}px`;
                        if (domOverlayContainer) domOverlayContainer.style.width = `${savedWidth}px`;
                        
                        // Устанавливаем значение для переопределения clientWidth
                        window.bannerWidthOverride = savedWidth;
                        
                        // Вызываем событие resize для обновления баннера
                        window.dispatchEvent(new Event('resize'));
                        
                        console.log(`[Banner Control] Применена сохраненная ширина: ${savedWidth}px`);
                    }
                    
                    // Переопределяем clientWidth
                    overrideClientWidth();
                } else {
                    // Выключаем режим изменения ширины
                    
                    // Сбрасываем переопределение clientWidth
                    window.bannerWidthOverride = null;
                    
                    // Восстанавливаем оригинальное поведение clientWidth
                    restoreClientWidth();
                    
                    // Восстанавливаем исходные размеры элементов, если они были сохранены
                    if (originalWidth !== null) {
                        animationContainer.style.width = `${originalWidth}px`;
                        
                        const canvas = document.getElementById('canvas');
                        const domOverlayContainer = document.getElementById('dom_overlay_container');
                        
                        if (canvas) canvas.style.width = `${originalWidth}px`;
                        if (domOverlayContainer) domOverlayContainer.style.width = `${originalWidth}px`;
                        
                        // Вызываем событие resize для обновления баннера
                        window.dispatchEvent(new Event('resize'));
                    }
                }
                
                // Сохраняем состояние
                saveBannerWidthSettings(
                    isWidthControlActive ? window.bannerWidthOverride : null, 
                    isWidthControlActive
                );
                
                // Меняем цвет кнопки в зависимости от состояния
                widthControlBtn.style.background = isWidthControlActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';
                
                // Показываем/скрываем элементы контроля ширины
                resizeHandle.style.opacity = isWidthControlActive ? '1' : '0';
                dragHandle.style.opacity = isWidthControlActive ? '1' : '0';
                
                // Включаем/отключаем перетаскивание
                resizeHandle.style.pointerEvents = isWidthControlActive ? 'auto' : 'none';
                dragHandle.style.pointerEvents = isWidthControlActive ? 'auto' : 'none';
            });
            
            // Добавляем кнопку в контейнер
            widthControlContainer.appendChild(widthControlBtn);
            
            // Добавляем контейнер в scaleBox
            scaleBox.appendChild(widthControlContainer);
            
            return widthControlBtn;
        }

        // Добавляем ползунок и маркер к контейнеру
        animationContainer.appendChild(resizeHandle);
        animationContainer.appendChild(dragHandle);
        
        // Если режим изменения ширины был активен до перезагрузки,
        // активируем его автоматически
        if (isWidthControlActive) {
            // Показываем элементы управления
            resizeHandle.style.opacity = '1';
            dragHandle.style.opacity = '1';
            resizeHandle.style.pointerEvents = 'auto';
            dragHandle.style.pointerEvents = 'auto';
            
            // Обновляем глобальное состояние
            window.isWidthControlActive = true;
            window.isBannerEditModeActive = true || (window.isRulersActive === true);
            
            // Сохраняем исходный размер
            if (originalWidth === null) {
                originalWidth = animationContainer.offsetWidth;
            }
            
            // Если есть сохраненная ширина, применяем её
            if (savedWidth !== null && savedWidth >= 200) {
                animationContainer.style.width = `${savedWidth}px`;
                
                const canvas = document.getElementById('canvas');
                const domOverlayContainer = document.getElementById('dom_overlay_container');
                
                if (canvas) canvas.style.width = `${savedWidth}px`;
                if (domOverlayContainer) domOverlayContainer.style.width = `${savedWidth}px`;
                
                // Устанавливаем значение для переопределения clientWidth
                window.bannerWidthOverride = savedWidth;
                
                // Переопределяем clientWidth
                overrideClientWidth();
                
                // Вызываем событие resize для обновления баннера
                window.dispatchEvent(new Event('resize'));
                
                console.log(`[Banner Control] Автоматически активирован режим изменения ширины с шириной: ${savedWidth}px`);
            }
        }
        
        // Сохраняем функцию для последующего использования
        window.createWidthControlButton = createWidthControlButton;
        
        console.log('[Banner Control] Управление шириной баннера инициализировано');
    }

    function initAnimatePanel(ORIGINAL_FPS) {
        // Проверка Animate-страницы с повторными попытками
        let checkAttempts = 0;
        const maxAttempts = 4;
        const checkDelay = 500; // 500ms между попытками
        
        function checkAnimationContainer() {
            checkAttempts++;
            const animationContainer = document.getElementById('animation_container');
            
            console.log(`[Animate Panel] Попытка ${checkAttempts}/${maxAttempts}: поиск animation_container...`);
            
            if (animationContainer) {
        console.log('[Animate Panel] Adobe Animate страница обнаружена');
        if (typeof ORIGINAL_FPS === 'undefined') {
            console.warn('[Animate Panel] ORIGINAL_FPS не найден: сброс FPS работать не будет');
        } else {
            console.log(`[Animate Panel] ORIGINAL_FPS: ${ORIGINAL_FPS}`);
        }
        
                // Контейнер найден, продолжаем инициализацию
                initializePanelComponents();
                return;
            }
            
            if (checkAttempts < maxAttempts) {
                console.log(`[Animate Panel] animation_container не найден, повтор через ${checkDelay}ms...`);
                setTimeout(checkAnimationContainer, checkDelay);
            } else {
                console.warn(`[Animate Panel] animation_container не найден после ${maxAttempts} попыток, прекращение инициализации`);
                return;
            }
        }
        
        function initializePanelComponents() {
        // Подключаем Material Icons
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        
        // Инициализируем управление шириной баннера
        initBannerWidthControl();

        // Настройки фона
        const bgExpanded = 'rgba(0, 0, 0, 0.7)'; 
        const bgCollapsed = 'transparent';

        // Создаём панель
        const panel = document.createElement('div');
        panel.className = 'aniplay-panel'; // Уникальный класс для идентификации
        Object.assign(panel.style, {
            position: 'fixed',
            top: '16px',
            left: '16px',
            background: bgExpanded,
            borderRadius: '10px',
            padding: '7px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transition: 'width 0.2s, height 0.2s, background 0.2s, opacity 0.2s',
            overflow: 'hidden',
            minWidth: '52px',
            fontFamily: 'Arial, sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            opacity: '1',
            pointerEvents: 'auto',
            width: 'auto',
            height: 'auto',
            paddingTop: '36px',
        });

        // Контейнер кнопок + счетчика
        const btnContainer = document.createElement('div');
        Object.assign(btnContainer.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
            marginTop: '6px',
            alignItems: 'center',
            width: '100%'
        });

        // === FPS drag-инпут ===
        const fpsDragContainer = document.createElement('div');
        Object.assign(fpsDragContainer.style, {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            margin: '2px 0',
            padding: '2px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            gap: '5px',
            userSelect: 'none',
        });
        // Окно FPS
        const fpsValueBox = document.createElement('div');
        Object.assign(fpsValueBox.style, {
            minWidth: '26px',
            padding: '2px 4px',
            fontSize: '13px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(30,30,30,0.85)',
            borderRadius: '6px',
            border: '1.5px solid #444',
            textAlign: 'center',
            cursor: 'ew-resize',
            letterSpacing: '0.5px',
            transition: 'background 0.15s, border 0.15s',
            outline: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.13)',
            userSelect: 'none',
        });
        fpsValueBox.title = 'Потяните влево/вправо для изменения FPS, двойной клик — сброс';
        fpsDragContainer.appendChild(fpsValueBox);
        btnContainer.appendChild(fpsDragContainer);
        // Логика drag
        let dragActive = false;
        let dragStartX = 0;
        let dragStartFps = 0;
        const FPS_MIN = 1;
        const FPS_MAX = 99;
        function setFps(val) {
            val = Math.round(Math.max(FPS_MIN, Math.min(FPS_MAX, val)));
            if (typeof createjs !== 'undefined' && createjs.Ticker) {
                createjs.Ticker.framerate = val;
            }
            fpsValueBox.textContent = val;
        }
        // Инициализация значения
        let initialFps = 30;
        if (typeof createjs !== 'undefined' && createjs.Ticker && createjs.Ticker.framerate) {
            initialFps = createjs.Ticker.framerate;
        }
        setFps(initialFps);
        // Drag events
        fpsValueBox.addEventListener('mousedown', (e) => {
            dragActive = true;
            dragStartX = e.clientX;
            dragStartFps = typeof createjs !== 'undefined' && createjs.Ticker ? createjs.Ticker.framerate : initialFps;
            fpsValueBox.style.background = 'rgba(60,60,60,0.95)';
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragActive) return;
            const dx = e.clientX - dragStartX;
            let newFps = dragStartFps + Math.round(dx / 3); // 3px = 1 FPS
            setFps(newFps);
        });
        window.addEventListener('mouseup', () => {
            if (dragActive) {
                dragActive = false;
                fpsValueBox.style.background = 'rgba(30,30,30,0.85)';
                document.body.style.cursor = '';
            }
        });
        // Двойной клик — сброс к исходному FPS
        fpsValueBox.addEventListener('dblclick', () => {
            if (typeof createjs !== 'undefined' && createjs.Ticker && typeof ORIGINAL_FPS !== 'undefined') {
                setFps(ORIGINAL_FPS);
            }
        });
        // Синхронизация при внешнем изменении FPS
        function syncFpsBox() {
        if (typeof createjs !== 'undefined' && createjs.Ticker) {
                fpsValueBox.textContent = Math.round(createjs.Ticker.framerate);
            }
        }
        setInterval(syncFpsBox, 500);

        // === Слайдер кадров ===
        const frameSliderContainer = document.createElement('div');
        Object.assign(frameSliderContainer.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            margin: '4px 0',
            padding: '4px 0',
            background: 'rgba(0,0,0,0.18)',
            borderRadius: '6px',
            gap: '4px',
            minHeight: 'unset',
            minWidth: '0',
            justifyContent: 'center'
        });

        // Вертикальный слайдер кадров
        const frameSlider = document.createElement('input');
        frameSlider.type = 'range';
        frameSlider.min = '0';
        frameSlider.value = '0';
        Object.assign(frameSlider.style, {
            width: '18px',
            height: '90px',
            appearance: 'none',
            background: 'rgba(204, 204, 204, 0.3)',
            outline: 'none',
            borderRadius: '7px',
            cursor: 'pointer',
            writingMode: 'bt-lr',
            WebkitAppearance: 'slider-vertical',
            transform: 'rotate(180deg)',
            margin: '0 4px 0 0',
            display: 'block',
        });
        frameSlider.disabled = true;
        frameSlider.classList.add('frame-slider');
        frameSliderContainer.appendChild(frameSlider);

        // === Drag-инпут выбора кадра ===
        const frameDragBox = document.createElement('div');
        Object.assign(frameDragBox.style, {
            minWidth: '32px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(30,30,30,0.85)',
            borderRadius: '6px',
            border: '1.5px solid #444',
            textAlign: 'center',
            cursor: 'ew-resize',
            letterSpacing: '0.5px',
            transition: 'background 0.15s, border 0.15s',
            outline: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.13)',
            userSelect: 'none',
            margin: '4px 0 0 0',
            alignSelf: 'center',
        });
            frameDragBox.title = 'Потяните влево/вправо для выбора кадра, двойной клик — редактировать кадр';
        frameSliderContainer.appendChild(frameDragBox);
            
            // Переменные для режима редактирования
            let isFrameEditing = false;
            let originalFrameValue = '';
            let frameInput = null; // Временный input элемент
            
        // Логика drag для кадров
        let frameDragActive = false;
        let frameDragStartX = 0;
        let frameDragStartVal = 1;
        let frameDragMax = 1;
        function setFrameDrag(val) {
            val = Math.max(1, Math.min(frameDragMax, Math.round(val)));
            if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                    // Ставим анимацию на паузу при ручном изменении кадра
                    window.exportRoot.paused = true;
                window.exportRoot.gotoAndStop(val - 1);
                fullUpdateSlider();
                    // Обновляем кнопку плей/пауза
                    updatePauseButton();
            }
                if (!isFrameEditing) {
            frameDragBox.textContent = val;
        }
            }
            
            // Функция для входа в режим редактирования
            function enterFrameEditMode() {
                if (isFrameEditing) return;
                
                // Ставим анимацию на паузу при входе в режим редактирования
                if (typeof window.exportRoot !== 'undefined') {
                    window.exportRoot.paused = true;
                    updatePauseButton();
                }
                
                isFrameEditing = true;
                originalFrameValue = frameDragBox.textContent;
                
                // Получаем точные размеры и позицию оригинального элемента
                const rect = frameDragBox.getBoundingClientRect();
                const computedStyle = window.getComputedStyle(frameDragBox);
                
                // ВАЖНО: Учитываем масштабирование панели!
                // Получаем текущий масштаб панели
                const currentScale = (1 / window.devicePixelRatio) * panelScale;
                
                // Вычисляем реальные размеры без учета масштабирования
                const realWidth = rect.width / currentScale;
                const realHeight = rect.height / currentScale;
                
                // Вычисляем позицию относительно панели без учета масштабирования
                const panelRect = panel.getBoundingClientRect();
                const relativeLeft = (rect.left - panelRect.left) / currentScale;
                const relativeTop = (rect.top - panelRect.top) / currentScale;
                
                // Создаем ПРОСТОЙ contentEditable div БЕЗ учета масштабирования
                frameInput = document.createElement('div');
                frameInput.contentEditable = true;
                frameInput.textContent = frameDragBox.textContent;
                
                // Применяем стили с реальными размерами (панель сама масштабирует)
                frameInput.style.cssText = `
                    position: absolute !important;
                    left: ${relativeLeft}px !important;
                    top: ${relativeTop}px !important;
                    width: ${realWidth}px !important;
                    height: ${realHeight}px !important;
                    max-width: ${realWidth}px !important;
                    min-width: ${realWidth}px !important;
                    max-height: ${realHeight}px !important;
                    min-height: ${realHeight}px !important;
                    overflow: hidden !important;
                    white-space: nowrap !important;
                    text-overflow: clip !important;
                    box-sizing: border-box !important;
                    margin: 0 !important;
                    padding: ${computedStyle.padding} !important;
                    font-size: ${computedStyle.fontSize} !important;
                    font-weight: ${computedStyle.fontWeight} !important;
                    font-family: ${computedStyle.fontFamily} !important;
                    color: #fff !important;
                    background: rgba(60,120,180,0.95) !important;
                    border-radius: ${computedStyle.borderRadius} !important;
                    border: 1.5px solid #4CAF50 !important;
                    text-align: center !important;
                    letter-spacing: ${computedStyle.letterSpacing} !important;
                    outline: none !important;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.13) !important;
                    resize: none !important;
                    z-index: 10001 !important;
                    user-select: text !important;
                    cursor: text !important;
                    line-height: ${computedStyle.lineHeight} !important;
                    display: block !important;
                    flex-shrink: 0 !important;
                    flex-grow: 0 !important;
                    word-wrap: normal !important;
                    word-break: normal !important;
                `;
                
                frameInput.title = 'Введите номер кадра и нажмите Enter';
                
                // Скрываем оригинальный элемент и добавляем contentEditable div В ПАНЕЛЬ
                frameDragBox.style.visibility = 'hidden';
                // Добавляем напрямую в панель, а не в родителя frameDragBox
                panel.appendChild(frameInput);
                
                // Фокусируемся и выделяем текст
                frameInput.focus();
                
                // Выделяем весь текст в contentEditable
                if (window.getSelection && document.createRange) {
                    const range = document.createRange();
                    range.selectNodeContents(frameInput);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
                
                // Обработчики для contentEditable div
                frameInput.addEventListener('keydown', handleFrameInputKeydown);
                frameInput.addEventListener('blur', handleFrameInputBlur);
                frameInput.addEventListener('input', handleFrameInputInput);
            }
            
            // Функция для выхода из режима редактирования
            function exitFrameEditMode(save = false) {
                if (!isFrameEditing || !frameInput) return;
                
                isFrameEditing = false;
                
                if (save) {
                    const newValue = parseInt(frameInput.textContent.trim(), 10);
                    if (!isNaN(newValue) && newValue >= 1 && newValue <= frameDragMax) {
                        setFrameDrag(newValue);
                    } else {
                        // Восстанавливаем исходное значение при неверном вводе
                        frameDragBox.textContent = originalFrameValue;
                    }
                } else {
                    // Отменяем изменения
                    frameDragBox.textContent = originalFrameValue;
                }
                
                // Удаляем contentEditable div из панели и показываем оригинальный элемент
                if (frameInput && frameInput.parentNode) {
                    frameInput.parentNode.removeChild(frameInput);
                }
                frameInput = null;
                frameDragBox.style.visibility = 'visible';
            }
            
            // Обработчики событий для input
            function handleFrameInputKeydown(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем изменения
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitFrameEditMode(false); // Отменяем изменения
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем при Tab
                }
            }
            
            function handleFrameInputBlur() {
                // Небольшая задержка, чтобы обработались другие события
                setTimeout(() => {
                    if (isFrameEditing) {
                        exitFrameEditMode(true);
                    }
                }, 100);
            }
            
            function handleFrameInputInput(e) {
                // Ограничиваем ввод только цифрами для contentEditable
                const value = e.target.textContent.replace(/[^0-9]/g, '');
                if (e.target.textContent !== value) {
                    e.target.textContent = value;
                    
                    // Перемещаем курсор в конец после изменения
                    if (window.getSelection && document.createRange) {
                        const range = document.createRange();
                        range.selectNodeContents(e.target);
                        range.collapse(false);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            }
            
        frameDragBox.addEventListener('mousedown', (e) => {
                if (isFrameEditing) return; // Игнорируем drag в режиме редактирования
                
            frameDragActive = true;
            frameDragStartX = e.clientX;
            frameDragStartVal = parseInt(frameDragBox.textContent, 10) || 1;
            frameDragBox.style.background = 'rgba(60,60,60,0.95)';
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
                if (!frameDragActive || isFrameEditing) return; // Игнорируем в режиме редактирования
            const dx = e.clientX - frameDragStartX;
            let newVal = frameDragStartVal + Math.round(dx / 4); // 4px = 1 кадр
            setFrameDrag(newVal);
        });
        window.addEventListener('mouseup', () => {
            if (frameDragActive) {
                frameDragActive = false;
                frameDragBox.style.background = 'rgba(30,30,30,0.85)';
                document.body.style.cursor = '';
            }
        });
            
            // Двойной клик — режим редактирования
            frameDragBox.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                enterFrameEditMode();
            });
            
            // Обработка клавиш в режиме редактирования
            frameDragBox.addEventListener('keydown', (e) => {
                if (!isFrameEditing) return;
                
                if (e.key === 'Enter') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем изменения
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitFrameEditMode(false); // Отменяем изменения
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    exitFrameEditMode(true); // Сохраняем при Tab
                }
            });
            
            // Выход из режима редактирования при потере фокуса
            frameDragBox.addEventListener('blur', () => {
                if (isFrameEditing) {
                    // Небольшая задержка, чтобы обработались другие события
                    setTimeout(() => {
                        if (isFrameEditing) {
                            exitFrameEditMode(true);
                        }
                    }, 100);
                }
            });
            
            // Ограничиваем ввод только цифрами
            frameDragBox.addEventListener('input', (e) => {
                if (!isFrameEditing) return;
                
                // Удаляем все нецифровые символы
                const value = frameDragBox.textContent.replace(/[^0-9]/g, '');
                if (frameDragBox.textContent !== value) {
                    frameDragBox.textContent = value;
                    
                    // Перемещаем курсор в конец
                    if (window.getSelection && document.createRange) {
                        const range = document.createRange();
                        range.selectNodeContents(frameDragBox);
                        range.collapse(false);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            });

        // Синхронизация при внешнем изменении кадра
        function syncFrameDragBox() {
            if (typeof window.exportRoot !== 'undefined') {
                let currentFrame = 0;
                let totalFrames = 1;
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }
                frameDragMax = totalFrames;
                    if (!isFrameEditing) {
                frameDragBox.textContent = (currentFrame + 1).toString();
                    }
            }
        }
        setInterval(syncFrameDragBox, 300);

        // Добавляем стили для тонкого трека и круглого маркера
        const frameSliderStyles = `
            input[type=range].frame-slider::-webkit-slider-thumb {
                appearance: none;
                width: 22px;
                height: 22px;
                background: #E0E0E0;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.13);
                border: 1px solid rgba(142, 142, 147, 0.5);
                margin-top: -9px;
            }
            input[type=range].frame-slider::-moz-range-thumb {
                width: 22px;
                height: 22px;
                background: #E0E0E0;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.13);
                border: 1px solid rgba(142, 142, 147, 0.5);
            }
            input[type=range].frame-slider::-webkit-slider-runnable-track {
                height: 8px;
                background: rgba(204, 204, 204, 0.5);
                border-radius: 4px;
            }
            input[type=range].frame-slider::-moz-range-track {
                height: 8px;
                background: rgba(204, 204, 204, 0.5);
                border-radius: 4px;
            }
            input[type=range].frame-slider {
                background: transparent;
                padding: 0;
                margin: 0;
            }
        `;
        const frameSliderStyleElement = document.createElement('style');
        frameSliderStyleElement.textContent = frameSliderStyles;
        document.head.appendChild(frameSliderStyleElement);
        
        // Обновление слайдера в реальном времени
        let isRafActive = true;
        let lastFrame = -1; // Для отслеживания изменений кадра
        let frameHistory = []; // История последних кадров
        
        function rafUpdateSlider() {
            if (isRafActive) {
                if (typeof window.exportRoot !== 'undefined') {
                    let currentFrame = 0;
                    
                    // Получаем текущий кадр
                    if (typeof window.exportRoot.currentFrame === 'number') {
                        currentFrame = window.exportRoot.currentFrame;
                    } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                        currentFrame = window.exportRoot.timeline.position;
                    }
                    
                    // Проверяем, изменился ли кадр
                    if (currentFrame !== lastFrame) {
                        // Обновляем слайдер только если не перетаскиваем его
                        if (!frameDragActive) {
                            frameSlider.value = currentFrame.toString();
                            frameDragBox.textContent = (currentFrame + 1).toString();
                        }
                        
                        // Сохраняем историю кадров для отладки
                        frameHistory.push(currentFrame);
                        if (frameHistory.length > 10) {
                            frameHistory.shift();
                        }
                        
                        lastFrame = currentFrame;
                    }
                }
                
                requestAnimationFrame(rafUpdateSlider);
            }
        }
        requestAnimationFrame(rafUpdateSlider);

        // Полное обновление слайдера (включая min/max)
        function fullUpdateSlider() {
            if (typeof window.exportRoot !== 'undefined') {
                let totalFrames = 0;
                let currentFrame = 0;
                
                // Получаем общее количество кадров
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }
                
                // Получаем текущий кадр
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }
                
                if (totalFrames > 0) {
                    frameSlider.max = (totalFrames - 1).toString();
                    
                    // Обновляем положение слайдера только если не перетаскиваем его
                    if (!frameDragActive) {
                        frameSlider.value = currentFrame.toString();
                        frameDragBox.textContent = (currentFrame + 1).toString();
                    }
                    
                    frameSlider.disabled = false;
                } else {
                    frameSlider.disabled = true;
                    frameDragBox.textContent = '-';
                }
            } else {
                frameSlider.disabled = true;
                frameDragBox.textContent = '-';
            }
        }

        // Периодически делаем полное обновление слайдера
        const fullUpdateInterval = setInterval(fullUpdateSlider, 300);

        // Слайдер перемещает по кадрам
        frameSlider.addEventListener('input', () => {
            if (typeof window.exportRoot !== 'undefined') {
                const frame = parseInt(frameSlider.value, 10);
                if (typeof window.exportRoot.gotoAndStop === 'function') {
                        // Ставим анимацию на паузу при ручном изменении кадра
                        window.exportRoot.paused = true;
                    window.exportRoot.gotoAndStop(frame);
                    fullUpdateSlider();
                    lastFrame = frame; // Обновляем lastFrame чтобы избежать ненужных обновлений
                        // Обновляем кнопку плей/пауза
                        updatePauseButton();
                }
            }
        });

        // При удалении панели очищаем requestAnimationFrame и интервал
        panel.addEventListener('remove', () => {
            isRafActive = false;
            clearInterval(fullUpdateInterval);
        });

        // === Кнопка и контейнер для маркеров ===
        const markerRow = document.createElement('div');
        Object.assign(markerRow.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            margin: '4px 0 0 0',
            maxHeight: '200px', // Ограничиваем высоту
            overflowY: 'auto', // Добавляем прокрутку если маркеров много
            overflowX: 'hidden',
            width: '100%',
            alignItems: 'center',
            minHeight: '28px',
            padding: '2px'
        });
        frameSliderContainer.appendChild(markerRow);

            // === Контейнер для кнопок управления маркерами ===
            const markerButtonsContainer = document.createElement('div');
            Object.assign(markerButtonsContainer.style, {
                display: 'flex',
                gap: '4px',
                margin: '0 0 4px 0',
                justifyContent: 'center',
                alignItems: 'center'
            });
            frameSliderContainer.appendChild(markerButtonsContainer);

        const addMarkerBtn = document.createElement('button');
        addMarkerBtn.textContent = '+';
        Object.assign(addMarkerBtn.style, {
                width: '30px',
                height: '26px',
                fontSize: '18px',
            borderRadius: '6px',
            border: 'none',
            background: '#3a3a3a',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 'bold',
                margin: '0',
            transition: 'background 0.2s',
            outline: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.13)'
        });
        addMarkerBtn.title = 'Добавить маркер на этот кадр';
        addMarkerBtn.addEventListener('mouseenter', () => { addMarkerBtn.style.background = '#555'; });
        addMarkerBtn.addEventListener('mouseleave', () => { addMarkerBtn.style.background = '#3a3a3a'; });
            markerButtonsContainer.appendChild(addMarkerBtn);
            
            // Кнопка очистки всех маркеров
            const clearMarkersBtn = document.createElement('button');
            clearMarkersBtn.textContent = '✕';
            Object.assign(clearMarkersBtn.style, {
                width: '30px',
                height: '26px',
                fontSize: '16px',
                borderRadius: '6px',
                border: 'none',
                background: '#b33',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
                margin: '0',
                transition: 'background 0.2s',
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.13)'
            });
            clearMarkersBtn.title = 'Очистить все маркеры';
            clearMarkersBtn.addEventListener('mouseenter', () => { clearMarkersBtn.style.background = '#d44'; });
            clearMarkersBtn.addEventListener('mouseleave', () => { clearMarkersBtn.style.background = '#b33'; });
            clearMarkersBtn.addEventListener('click', () => {
                if (frameMarkers.length > 0 && confirm(`Удалить все ${frameMarkers.length} маркеров?`)) {
                    frameMarkers = [];
                    renderMarkers();
                    saveFrameMarkers();
                    updateMarkersVisibility(); // Обновляем видимость после очистки
                    console.log('[Frame Markers] Все маркеры очищены');
                }
            });
            markerButtonsContainer.appendChild(clearMarkersBtn);

        let frameMarkers = [];
            
            // === Функции для сохранения и загрузки маркеров ===
            function saveFrameMarkers() {
                try {
                    localStorage.setItem('animateFrameMarkers', JSON.stringify(frameMarkers));
                    console.log('[Frame Markers] Маркеры сохранены:', frameMarkers);
                } catch(e) {
                    console.warn('[Frame Markers] Ошибка при сохранении маркеров:', e);
                }
            }
            
            function loadFrameMarkers() {
                try {
                    const saved = localStorage.getItem('animateFrameMarkers');
                    if (saved) {
                        const parsedMarkers = JSON.parse(saved);
                        if (Array.isArray(parsedMarkers)) {
                            frameMarkers = parsedMarkers.filter(marker => 
                                typeof marker === 'number' && marker >= 0
                            );
                            if (frameMarkers.length > 0) {
                                console.log(`[Frame Markers] Загружено ${frameMarkers.length} сохраненных маркеров:`, frameMarkers.map(f => f + 1));
                                renderMarkers();
                            } else {
                                console.log('[Frame Markers] Сохраненные маркеры не найдены');
                            }
                        }
                    } else {
                        console.log('[Frame Markers] Нет сохраненных маркеров');
                    }
                } catch(e) {
                    console.warn('[Frame Markers] Ошибка при загрузке маркеров:', e);
                    frameMarkers = [];
                }
            }
            
            // Загружаем сохраненные маркеры при инициализации
            loadFrameMarkers();
            
            // Устанавливаем правильную видимость при инициализации
            setTimeout(() => {
                updateMarkersVisibility();
            }, 100);
            
            // Функция для управления видимостью контейнеров маркеров
            function updateMarkersVisibility() {
                const hasMarkers = frameMarkers.length > 0;
                
                // Показываем/скрываем контейнер с маркерами
                markerRow.style.display = hasMarkers ? 'flex' : 'none';
                
                // Кнопки управления показываем всегда, но меняем margin
                if (hasMarkers) {
                    // Если есть маркеры - обычный отступ
                    markerButtonsContainer.style.margin = '0 0 4px 0';
                } else {
                    // Если маркеров нет - убираем верхний отступ чтобы не было пустого места
                    markerButtonsContainer.style.margin = '4px 0 4px 0';
                }
                
                console.log(`[Frame Markers] Обновлена видимость: hasMarkers=${hasMarkers}`);
            }
            
        function renderMarkers() {
            markerRow.innerHTML = '';
            frameMarkers.sort((a, b) => a - b);
            frameMarkers.forEach(frame => {
                const btn = document.createElement('button');
                btn.style.position = 'relative';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'space-between';
                Object.assign(btn.style, {
                    width: '44px',
                    height: '20px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#e0e0e0',
                    color: '#222',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    margin: '1px 0',
                    padding: '0 6px',
                    transition: 'background 0.2s',
                    outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
                btn.title = `Перейти к кадру ${frame + 1}`;
                btn.addEventListener('mouseenter', () => { btn.style.background = '#bdbdbd'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = '#e0e0e0'; });
                // Клик по номеру — переход
                btn.addEventListener('click', (e) => {
                    // Если клик по крестику — не переходить
                    if (e.target.classList.contains('marker-remove')) return;
                    if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                            // Ставим анимацию на паузу при переходе к кадру через маркер
                            window.exportRoot.paused = true;
                        window.exportRoot.gotoAndStop(frame);
                        fullUpdateSlider();
                            // Обновляем кнопку плей/пауза
                            updatePauseButton();
                    }
                });
                // Номер кадра
                const numSpan = document.createElement('span');
                numSpan.textContent = (frame + 1).toString();
                numSpan.style.pointerEvents = 'none';
                btn.appendChild(numSpan);
                // Крестик для удаления
                const removeBtn = document.createElement('span');
                removeBtn.textContent = '×';
                removeBtn.className = 'marker-remove';
                Object.assign(removeBtn.style, {
                    fontSize: '14px',
                    color: '#b00',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    lineHeight: '1',
                    fontWeight: 'bold',
                    padding: '0 0 0 4px'
                });
                removeBtn.title = 'Удалить маркер';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    frameMarkers = frameMarkers.filter(f => f !== frame);
                    renderMarkers();
                        saveFrameMarkers(); // Сохраняем после удаления
                        updateMarkersVisibility(); // Обновляем видимость после удаления
                });
                btn.appendChild(removeBtn);
                markerRow.appendChild(btn);
            });
                
                // Обновляем видимость после рендеринга
                updateMarkersVisibility();
        }

        addMarkerBtn.addEventListener('click', () => {
            let val = parseInt(frameDragBox.textContent, 10);
            if (isNaN(val) || val < 1) return;
            const frame = val - 1;
            if (!frameMarkers.includes(frame)) {
                frameMarkers.push(frame);
                renderMarkers();
                    saveFrameMarkers(); // Сохраняем после добавления
                    updateMarkersVisibility(); // Обновляем видимость после добавления
            }
        });

        btnContainer.appendChild(frameSliderContainer);

        // Добавляем кнопку паузы
        const pauseBtn = document.createElement('button');
        const pauseIcon = document.createElement('span');
        pauseIcon.className = 'material-icons';
        pauseIcon.textContent = 'pause'; // Начальное состояние - показываем паузу (т.к. анимация по умолчанию воспроизводится)
        pauseBtn.appendChild(pauseIcon);
        pauseBtn.title = 'Остановить воспроизведение';
        Object.assign(pauseBtn.style, {
            width: '44px',
            height: '44px',
            padding: '0',
            margin: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            cursor: 'pointer',
            transition: 'background 0.2s',
            fontSize: '22px'
        });
        
        // hover
        pauseBtn.addEventListener('mouseenter', () => { pauseBtn.style.background = 'rgba(255,255,255,0.2)'; });
        pauseBtn.addEventListener('mouseleave', () => { pauseBtn.style.background = 'rgba(0,0,0,0.5)'; });
        
        // Обновление иконки и заголовка в зависимости от состояния
        function updatePauseButton() {
            if (typeof window.exportRoot !== 'undefined') {
                if (window.exportRoot.paused) {
                    pauseIcon.textContent = 'play_arrow';
                    pauseBtn.title = 'Запустить воспроизведение';
                } else {
                    pauseIcon.textContent = 'pause';
                    pauseBtn.title = 'Остановить воспроизведение';
                }
            }
        }
        
        // Обработчик клика
        pauseBtn.addEventListener('click', () => {
            if (typeof window.exportRoot !== 'undefined') {
                window.exportRoot.paused = !window.exportRoot.paused;
                updatePauseButton();
                console.log(`[Paused toggle] ${window.exportRoot.paused}`);
            }
        });
        
        btnContainer.appendChild(pauseBtn);
        
        // Функция создания кнопки с иконкой и hover-эффектом - оставляем для возможного использования в будущем
        function addIconButton(iconName, title, onClick) {
            const btn = document.createElement('button');
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.textContent = iconName;
            btn.appendChild(icon);
            btn.title = title;
            Object.assign(btn.style, {
                width: '32px',
                height: '32px',
                padding: '0',
                margin: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
                transition: 'background 0.2s'
            });
            // hover
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.5)'; });
            btn.addEventListener('click', () => { onClick(); });
            btnContainer.appendChild(btn);
        }

        // === Кнопка сворачивания ===
        const collapseBtn = document.createElement('button');
        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'material-icons';
        collapseIcon.textContent = 'chevron_left';
        collapseBtn.appendChild(collapseIcon);
        Object.assign(collapseBtn.style, {
            position: 'absolute',
            top: '8px',
            left: '8px',
            right: 'auto',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.18)',
            border: 'none',
            borderRadius: '50%',
            color: '#fff',
            cursor: 'pointer',
            zIndex: '10001',
            fontSize: '22px',
            transition: 'background 0.2s',
        });
        collapseBtn.addEventListener('mouseenter', () => { collapseBtn.style.background = 'rgba(255,255,255,0.18)'; });
        collapseBtn.addEventListener('mouseleave', () => { collapseBtn.style.background = 'rgba(0,0,0,0.18)'; });
        panel.appendChild(collapseBtn);
        panel.style.position = 'fixed';
        panel.style.top = '16px';
        panel.style.left = '16px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.minWidth = '52px';
        panel.style.minHeight = '52px';
        panel.style.boxSizing = 'border-box';
        panel.style.paddingTop = '36px';
        // Состояние
        let isCollapsed = false;
        // Восстанавливаем состояние из localStorage
        const savedPanelCollapsed = localStorage.getItem('animatePanelCollapsed');
        if (savedPanelCollapsed === 'true') isCollapsed = true;
        function setPanelCollapsed(collapsed) {
            isCollapsed = collapsed;
            localStorage.setItem('animatePanelCollapsed', collapsed ? 'true' : 'false');
            if (collapsed) {
                btnContainer.style.display = 'none';
                panel.style.width = '52px';
                panel.style.height = '52px';
                panel.style.minWidth = '52px';
                panel.style.minHeight = '52px';
                collapseIcon.textContent = 'chevron_right';
                
                // Сделаем панель почти невидимой в свернутом состоянии
                panel.style.opacity = '0.00';
                
                // Удаляем класс развернутой панели и добавляем класс свернутой
                panel.classList.remove('panel-expanded');
                panel.classList.add('panel-collapsed');
            } else {
                btnContainer.style.display = 'flex';
                panel.style.width = 'auto';
                panel.style.height = 'auto';
                panel.style.minWidth = '52px';
                panel.style.minHeight = '52px';
                collapseIcon.textContent = 'chevron_left';
                
                // Сделаем панель полностью видимой в развернутом состоянии
                panel.style.opacity = '1';
                
                // Удаляем класс свернутой панели и добавляем класс развернутой
                panel.classList.remove('panel-collapsed');
                panel.classList.add('panel-expanded');
            }
        }
        setPanelCollapsed(isCollapsed);
        
        // Добавляем события для отображения свернутой панели при наведении
        panel.addEventListener('mouseenter', () => {
            // Показываем панель при наведении только если она свернута
            if (isCollapsed) {
                panel.style.opacity = '1';
            }
        });
        
        panel.addEventListener('mouseleave', () => {
            // Скрываем панель при уходе курсора только если она свернута
            if (isCollapsed) {
                panel.style.opacity = '0.00';
            }
        });
        
        // Делаем плавный переход для opacity
        panel.style.transition = 'opacity 0.3s, width 0.2s, height 0.2s, background 0.2s';
        
        // === devicePixelRatio compensation ===
        function getZoomCompensated(val) {
            return Math.round(val);
        }
        function getUnzoomCompensated(val) {
            return Math.round(val);
        }

        // === Масштаб панели ===
        let panelScale = 1.0;
        const SCALE_MIN = 0.5;
        const SCALE_MAX = 2.0;
        const SCALE_STEP = 0.1;

        function savePanelScale() {
            localStorage.setItem('animatePanelScale', panelScale.toString());
        }

        // Загружаем сохраненный масштаб
        try {
            const savedScale = parseFloat(localStorage.getItem('animatePanelScale'));
            if (!isNaN(savedScale) && savedScale >= SCALE_MIN && savedScale <= SCALE_MAX) {
                panelScale = savedScale;
            }
        } catch (e) {
            console.warn('Ошибка при загрузке сохраненного масштаба:', e);
        }

        // Добавляем элемент для изменения размера
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, {
            position: 'absolute',
            right: '0',
            bottom: '0',
            width: '20px',
            height: '20px',
            cursor: 'nwse-resize',
            zIndex: '10003',
            background: 'transparent',
            opacity: '0.001', // Почти прозрачный, но реагирует на события
        });

        // Добавляем визуальный индикатор
        const resizeIcon = document.createElement('div');
        Object.assign(resizeIcon.style, {
            position: 'absolute',
            right: '4px',
            bottom: '4px',
            width: '12px',
            height: '12px',
            pointerEvents: 'none',
            borderRight: '2px solid rgba(255,255,255,0.5)',
            borderBottom: '2px solid rgba(255,255,255,0.5)',
            opacity: '0.7',
        });

        panel.appendChild(resizeHandle);
        panel.appendChild(resizeIcon);

        // Обработка перетаскивания для изменения масштаба
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartScale = 1.0;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartScale = panelScale;
            document.body.style.cursor = 'nwse-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const dx = e.clientX - resizeStartX;
            const scaleDelta = dx * 0.005; // Коэффициент чувствительности
            const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, resizeStartScale + scaleDelta));
            
            if (newScale !== panelScale) {
                panelScale = newScale;
                applyPanelScaleAndZoom();
                savePanelScale();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
            }
        });

        function applyPanelScaleAndZoom() {
            const zoom = (1 / window.devicePixelRatio) * panelScale;
            panel.style.transform = `scale(${zoom})`;
            panel.style.transformOrigin = 'top left';
        }
        applyPanelScaleAndZoom();
        
        function setPanelPosition(left, top) {
            // Получаем размеры окна браузера
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            // Получаем размеры панели
            const panelRect = panel.getBoundingClientRect();
            const panelWidth = panelRect.width / (1 / window.devicePixelRatio * panelScale);
            const panelHeight = panelRect.height / (1 / window.devicePixelRatio * panelScale);
            
            // Ограничиваем позицию панели границами окна браузера
            // Добавляем небольшой запас, чтобы панель не прилипала вплотную к краю
            const buffer = 5;
            
            // Ограничиваем левую и правую границы
            left = Math.max(buffer, Math.min(left, windowWidth - panelWidth - buffer));
            
            // Ограничиваем верхнюю и нижнюю границы
            // Учитываем наличие информационной панели внизу (24px)
            const bottomBarHeight = 24;
            top = Math.max(buffer, Math.min(top, windowHeight - panelHeight - bottomBarHeight - buffer));
            
            // Устанавливаем позицию
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
        setPanelPosition(16, 16);

        // При изменении devicePixelRatio пересчитать transform и позицию
        window.addEventListener('resize', () => {
            applyPanelScaleAndZoom();
            const rect = panel.getBoundingClientRect();
            
            // После изменения размера окна проверяем, не выходит ли панель за его пределы
            setPanelPosition(rect.left, rect.top);
        });

        // Обработчик колесика мыши для масштабирования
        panel.addEventListener('wheel', (e) => {
            if (!e.altKey) return; // Только при зажатом Alt

            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            const oldScale = panelScale;
            panelScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, panelScale + direction * SCALE_STEP));
            
            if (oldScale !== panelScale) {
                const rect = panel.getBoundingClientRect();
                applyPanelScaleAndZoom();
                savePanelScale();
            }
        });

        // === Drag&Drop только за collapseBtn ===
        collapseBtn.style.cursor = 'move';
        let panelDragActive = false;
        let panelDragStartX = 0;
        let panelDragStartY = 0;
        let panelStartLeft = 16;
        let panelStartTop = 16;
        let panelDragMoved = false;
        collapseBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            panelDragActive = true;
            panelDragMoved = false;
            panelDragStartX = e.clientX;
            panelDragStartY = e.clientY;
            // panelStartLeft/Top в логических px
            const rect = panel.getBoundingClientRect();
            panelStartLeft = getUnzoomCompensated(rect.left);
            panelStartTop = getUnzoomCompensated(rect.top);
            panel.style.transition = 'none';
            document.body.style.cursor = 'move';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!panelDragActive) return;
            const dx = e.clientX - panelDragStartX;
            const dy = e.clientY - panelDragStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panelDragMoved = true;
            setPanelPosition(panelStartLeft + dx, panelStartTop + dy);
        });
        window.addEventListener('mouseup', () => {
            if (panelDragActive) {
                panelDragActive = false;
                panel.style.transition = '';
                document.body.style.cursor = '';
            }
        });

        // === Кнопка включения/выключения линеек ===
        const scaleBox = document.createElement('div');
        Object.assign(scaleBox.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: '10002',
            margin: '8px 0 0 0',
            alignSelf: 'center',
            justifyContent: 'center',
            alignItems: 'center',
        });

        const rulersBtn = document.createElement('button');
            rulersBtn.title = 'Показать/скрыть линейки и гайды\nКлик на свободное место — рисование прямоугольников (можно рисовать много подряд)\nПеретаскивание от линеек — создание гайдов';
        rulersBtn.innerHTML = '<span class="material-icons" style="font-size:28px;">straighten</span>';
        Object.assign(rulersBtn.style, {
            width: '44px', height: '44px',
            borderRadius: '8px',
            border: 'none', 
            background: 'rgba(0,0,0,0.5)', 
            color: '#fff', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            padding: '0', 
            boxShadow: '0 2px 8px rgba(0,0,0,0.13)', 
            transition: 'background 0.18s, box-shadow 0.18s', 
            margin: '0 0 0 0', 
            alignSelf: 'center',
        });
        
        // Состояние активности линеек
        window.isRulersActive = false;
        
        // Обновление цвета кнопки в зависимости от состояния
        function updateRulersBtnColor() {
            // Используем тот же зеленый цвет, что и для кнопки изменения ширины
            rulersBtn.style.background = window.isRulersActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';
        }
        
        rulersBtn.addEventListener('mouseenter', () => { 
            rulersBtn.style.background = 'rgba(255,255,255,0.2)'; 
        });
        
        rulersBtn.addEventListener('mouseleave', () => { 
            // При уходе мыши восстанавливаем цвет в зависимости от состояния
            updateRulersBtnColor();
        });
        
        rulersBtn.addEventListener('mousedown', () => { 
            rulersBtn.style.background = 'rgba(255,255,255,0.32)'; 
        });
        
        rulersBtn.addEventListener('mouseup', () => { 
            rulersBtn.style.background = 'rgba(255,255,255,0.2)'; 
        });
        
        // Вставляем кнопку rulersBtn в scaleBox
        scaleBox.appendChild(rulersBtn);
        
        // Добавляем кнопку управления шириной баннера
        if (window.createWidthControlButton) {
            window.createWidthControlButton(scaleBox);
        }
        
        btnContainer.appendChild(scaleBox);

        // Показывать кнопки только если панель развернута
        function updateScaleBoxVisibility() {
            scaleBox.style.display = isCollapsed ? 'none' : 'flex';
        }
        updateScaleBoxVisibility();
        // Вызов при изменении состояния панели
        const origSetPanelCollapsed = setPanelCollapsed;
        setPanelCollapsed = function(collapsed) {
            origSetPanelCollapsed(collapsed);
            updateScaleBoxVisibility();
        };
        // Обработчик кнопки сворачивания
        collapseBtn.addEventListener('click', (e) => {
            if (panelDragMoved) {
                panelDragMoved = false;
                return;
            }
            setPanelCollapsed(!isCollapsed);
        });

        // === Контейнер для линеек и гайдов ===
        const rulersOverlay = document.createElement('div');
        Object.assign(rulersOverlay.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: '2147483646',
        });
        rulersOverlay.style.display = 'none';
        document.body.appendChild(rulersOverlay);

        // Горизонтальная линейка
        const rulerH = document.createElement('canvas');
        rulerH.width = window.innerWidth;
        rulerH.height = 24;
        Object.assign(rulerH.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '100vw',
            height: '24px',
            background: 'rgba(30,30,30,0.01)', // Еще более прозрачный фон
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: 'ns-resize', // Курсор для перетаскивания
            transition: 'background 0.2s', // Плавный переход при наведении
        });
        rulersOverlay.appendChild(rulerH);

        // Вертикальная линейка
        const rulerV = document.createElement('canvas');
        rulerV.width = 24;
        rulerV.height = window.innerHeight;
        Object.assign(rulerV.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '24px',
            height: '100vh',
            background: 'rgba(30,30,30,0.01)', // Еще более прозрачный фон
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: 'ew-resize', // Курсор для перетаскивания
            transition: 'background 0.2s', // Плавный переход при наведении
        });
        rulersOverlay.appendChild(rulerV);

        // Добавляем обработчики для изменения видимости линеек при наведении
        let isRulerHHovered = false;
        let isRulerVHovered = false;
        
        rulerH.addEventListener('mouseenter', () => {
            isRulerHHovered = true;
            rulerH.style.background = 'rgba(30,30,30,0.3)';
            drawRulers();
        });
        rulerH.addEventListener('mouseleave', () => {
            isRulerHHovered = false;
            rulerH.style.background = 'rgba(30,30,30,0.01)';
            drawRulers();
        });
        
        rulerV.addEventListener('mouseenter', () => {
            isRulerVHovered = true;
            rulerV.style.background = 'rgba(30,30,30,0.3)';
            drawRulers();
        });
        rulerV.addEventListener('mouseleave', () => {
            isRulerVHovered = false;
            rulerV.style.background = 'rgba(30,30,30,0.01)';
            drawRulers();
        });

        // Временные гайды при перетаскивании
        let tempGuide = null;
        let isDraggingNewGuide = false;
        let dragStartPos = 0;

        // Создание временного гайда
        function createTempGuide(isHorizontal) {
            const guide = document.createElement('div');
            Object.assign(guide.style, {
                position: 'fixed',
                background: 'rgba(255,200,0,0.7)',
                pointerEvents: 'none',
                zIndex: '2147483647',
                boxShadow: '0 0 8px 2px rgba(255,200,0,0.3)',
            });
            if (isHorizontal) {
                Object.assign(guide.style, {
                    left: '0',
                    width: '100vw',
                        height: '1px',
                });
            } else {
                Object.assign(guide.style, {
                    top: '0',
                        width: '1px',
                    height: '100vh',
                });
            }
            return guide;
        }

        // Обработчики для горизонтальной линейки
        rulerH.addEventListener('mousedown', (e) => {
            isDraggingNewGuide = true;
            dragStartPos = e.clientY;
            tempGuide = createTempGuide(true);
            tempGuide.style.top = dragStartPos + 'px';
            guidesContainer.appendChild(tempGuide);
            document.body.style.cursor = 'ns-resize';
        });

        // Обработчики для вертикальной линейки
        rulerV.addEventListener('mousedown', (e) => {
            isDraggingNewGuide = true;
            dragStartPos = e.clientX;
            tempGuide = createTempGuide(false);
            tempGuide.style.left = dragStartPos + 'px';
            guidesContainer.appendChild(tempGuide);
            document.body.style.cursor = 'ew-resize';
        });

        // Общие обработчики перемещения и отпускания
        window.addEventListener('mousemove', (e) => {
            if (!isDraggingNewGuide || !tempGuide) return;

                if (tempGuide.style.height === '1px') { // Горизонтальный гайд
                tempGuide.style.top = e.clientY + 'px';
            } else { // Вертикальный гайд
                tempGuide.style.left = e.clientX + 'px';
            }
        });

            // ОБЪЕДИНЕННЫЙ обработчик mouseup для всех операций
        window.addEventListener('mouseup', (e) => {
                // === СОЗДАНИЕ ГАЙДОВ ===
                if (isDraggingNewGuide && tempGuide) {
                    if (tempGuide.style.height === '1px') { // Горизонтальный гайд
                const y = e.clientY;
                if (y > 24) { // Убедимся, что гайд не создается в области линейки
                    hGuides.push(y);
                }
            } else { // Вертикальный гайд
                const x = e.clientX;
                if (x > 24) { // Убедимся, что гайд не создается в области линейки
                    vGuides.push(x);
                }
            }

            // Очистка
            if (tempGuide.parentNode) {
                tempGuide.parentNode.removeChild(tempGuide);
            }
            tempGuide = null;
            isDraggingNewGuide = false;
            document.body.style.cursor = '';
            
            saveGuides();
            renderGuides();
                    return; // Выходим, чтобы не выполнять другие обработчики
                }

                // === СОЗДАНИЕ ПРЯМОУГОЛЬНИКОВ ===
                if (drawingRect && drawingStart && drawingRectData) {
                    if (drawingRectData.width < 5 || drawingRectData.height < 5) {
                        if (drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
                    } else {
                        drawnRects.push({ ...drawingRectData });
                    }
                    if (drawingRect && drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
                    drawingRect = null;
                    drawingStart = null;
                    drawingRectData = null;
                    renderGuides();
                    return; // Выходим, чтобы не выполнять другие обработчики
                }

                // === ИЗМЕНЕНИЕ РАЗМЕРА ПРЯМОУГОЛЬНИКОВ ===
                if (resizingRectIdx !== null) {
                    resizingRectIdx = null;
                    resizingHandle = null;
                    resizeStart = null;
                    return; // Выходим, чтобы не выполнять другие обработчики
                }

                // === ПЕРЕМЕЩЕНИЕ ГАЙДОВ ===
                if (draggingGuide) {
                    saveGuides();
                    draggingGuide = null;
                    dragType = null;
                    dragIndex = -1;
                    document.body.style.cursor = '';
                    return; // Выходим
                }
        });

        // Удаляем старые обработчики клика по линейкам
        rulerH.removeEventListener('click', null);
        rulerV.removeEventListener('click', null);

        // === Гайды ===
        let hGuides = [];
        let vGuides = [];
        // === Прямоугольники ===
        let drawnRects = [];
        let drawingRect = null;
        let drawingStart = null;
        let drawingRectData = null;
        // === Resize state ===
        let resizingRectIdx = null;
        let resizingHandle = null;
        let resizeStart = null;
        // === Move state ===
        let movingRectIdx = null;
        let moveStart = null;
        let moveOrig = null;
        // Восстановление из localStorage
        try {
            const saved = JSON.parse(localStorage.getItem('animatePanelGuides') || '{}');
            if (Array.isArray(saved.h)) hGuides = saved.h;
            if (Array.isArray(saved.v)) vGuides = saved.v;
        } catch {}
        // Контейнер для div-гайдов
        const guidesContainer = document.createElement('div');
        Object.assign(guidesContainer.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
                pointerEvents: 'none', // По умолчанию не перехватываем события
            zIndex: '2147483647',
        });
        guidesContainer.style.display = 'none';
        document.body.appendChild(guidesContainer);
            
            // Создаем специальный слой для перехвата событий рисования
            const drawingLayer = document.createElement('div');
            Object.assign(drawingLayer.style, {
                position: 'fixed',
                left: '0',
                top: '0',
                width: '100vw',
                height: '100vh',
                pointerEvents: 'auto',
                zIndex: '2147483640', // Ниже чем другие UI элементы
                background: 'transparent',
            });
            drawingLayer.style.display = 'none';
            document.body.appendChild(drawingLayer);
            
        // Сохранение
        function saveGuides() {
            localStorage.setItem('animatePanelGuides', JSON.stringify({ h: hGuides, v: vGuides }));
        }

                // === Рисование прямоугольников мышкой ===
                // Фиксированный цвет для прямоугольников
                const RECTANGLE_COLOR = 'rgba(0, 120, 255, 0.25)';
                
                // Функция для проверки, близко ли клик к существующим гайдам
                function isNearGuide(x, y, threshold = 5) {
                    // Проверяем близость к вертикальным гайдам
                    for (let guideX of vGuides) {
                        if (Math.abs(x - guideX) <= threshold) {
                            return true;
                        }
                    }
                    
                    // Проверяем близость к горизонтальным гайдам  
                    for (let guideY of hGuides) {
                        if (Math.abs(y - guideY) <= threshold) {
                            return true;
                        }
                    }
                    
                    return false;
                }
                
                // Функция для проверки, находится ли клик рядом с углом прямоугольника
                function isNearRectangleEdge(x, y, threshold = 4) {
                    for (let rect of drawnRects) {
                        // Проверяем близость к краям прямоугольника
                        const left = rect.left;
                        const right = rect.left + rect.width;
                        const top = rect.top;
                        const bottom = rect.top + rect.height;
                        
                        // Проверяем близость к вертикальным краям
                        if ((Math.abs(x - left) <= threshold || Math.abs(x - right) <= threshold) &&
                            y >= top - threshold && y <= bottom + threshold) {
                            return true;
                        }
                        
                        // Проверяем близость к горизонтальным краям  
                        if ((Math.abs(y - top) <= threshold || Math.abs(y - bottom) <= threshold) &&
                            x >= left - threshold && x <= right + threshold) {
                            return true;
                        }
                    }
                    
                    return false;
                }
                
                // Функция для проверки, находится ли клик в области линеек
                function isInRulerArea(x, y) {
                    return x <= 24 || y <= 24;
                }
                
                // Функция для проверки, находится ли клик в области панели управления
                function isInPanelArea(x, y) {
                    const panelRect = panel.getBoundingClientRect();
                    return x >= panelRect.left && x <= panelRect.right && 
                           y >= panelRect.top && y <= panelRect.bottom;
                }
                
                // Функция для проверки, находится ли клик в области статус-бара
                function isInStatusBarArea(x, y) {
                    const statusBarRect = statusBar.getBoundingClientRect();
                    return x >= statusBarRect.left && x <= statusBarRect.right && 
                           y >= statusBarRect.top && y <= statusBarRect.bottom;
                }
                
                // Улучшенная логика обработки кликов в области линеек и гайдов
                drawingLayer.addEventListener('mousedown', (e) => {
                if (rulersOverlay.style.display === 'none') return;
                if (e.button !== 0) return;
                    
                    const clickX = e.clientX;
                    const clickY = e.clientY;
                    
                    // Если клик в области линеек, не рисуем прямоугольник
                    if (isInRulerArea(clickX, clickY)) return;
                    
                    // Если клик в области панели управления, передаем событие панели
                    if (isInPanelArea(clickX, clickY)) {
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(clickX, clickY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';
                        // Если есть элемент под курсором, отправляем ему событие
                        if (elementUnder) {
                            const newEvent = new MouseEvent('mousedown', {
                                bubbles: true,
                                cancelable: true,
                                clientX: clickX,
                                clientY: clickY,
                                button: e.button,
                                buttons: e.buttons
                            });
                            elementUnder.dispatchEvent(newEvent);
                        }
                        return;
                    }
                    
                    // Если клик рядом с существующим гайдом, не рисуем прямоугольник
                    if (isNearGuide(clickX, clickY)) return;
                    
                    // Если клик рядом с углом прямоугольника, не рисуем прямоугольник
                    if (isNearRectangleEdge(clickX, clickY)) return;
                    
                    // Если добрались до сюда - можно рисовать прямоугольник
                    drawingStart = { x: clickX, y: clickY };
                    drawingRectData = { left: drawingStart.x, top: drawingStart.y, width: 1, height: 1, color: RECTANGLE_COLOR };
                drawingRect = document.createElement('div');
                Object.assign(drawingRect.style, {
                    position: 'fixed',
                    left: `${drawingRectData.left}px`,
                    top: `${drawingRectData.top}px`,
                    width: `${drawingRectData.width}px`,
                    height: `${drawingRectData.height}px`,
                    border: `1.5px solid #2196f3`,
                    background: drawingRectData.color,
                    zIndex: '2147483648',
                    pointerEvents: 'none',
                    borderRadius: '0px',
                    boxSizing: 'border-box',
                    cursor: 'crosshair',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    });
                    
                    // Создаем текстовую метку с размерами для временного прямоугольника
                    const drawingSizeLabel = document.createElement('div');
                    drawingSizeLabel.textContent = `${Math.round(drawingRectData.width)}×${Math.round(drawingRectData.height)}`;
                    Object.assign(drawingSizeLabel.style, {
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: '#2196f3',
                        background: 'rgba(255, 255, 255, 0.9)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        border: '1px solid #2196f3',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontFamily: 'Arial, sans-serif',
                        lineHeight: '1',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        zIndex: '2147483649'
                    });
                    
                    drawingRect.appendChild(drawingSizeLabel);
                guidesContainer.appendChild(drawingRect);
                e.preventDefault();
            });
            
            window.addEventListener('mousemove', (e) => {
                if (!drawingRect || !drawingStart || !drawingRectData) return;
                const x1 = drawingStart.x;
                const y1 = drawingStart.y;
                const x2 = e.clientX;
                const y2 = e.clientY;
                const left = Math.min(x1, x2);
                const top = Math.min(y1, y2);
                const width = Math.abs(x2 - x1);
                const height = Math.abs(y2 - y1);
                Object.assign(drawingRect.style, {
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    height: `${height}px`,
                });
                drawingRectData.left = left;
                drawingRectData.top = top;
                drawingRectData.width = width;
                drawingRectData.height = height;
                    
                    // Обновляем текст размеров в реальном времени
                    const sizeLabel = drawingRect.querySelector('div');
                    if (sizeLabel) {
                        sizeLabel.textContent = `${Math.round(width)}×${Math.round(height)}`;
                    }
                });
                
                // Добавляем проксирование событий click для UI элементов
                drawingLayer.addEventListener('click', (e) => {
                    if (rulersOverlay.style.display === 'none') return;
                    
                    const clickX = e.clientX;
                    const clickY = e.clientY;
                    
                    // Если клик в области панели управления, проксируем событие
                    if (isInPanelArea(clickX, clickY)) {
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(clickX, clickY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';
                        // Если есть элемент под курсором, отправляем ему событие
                        if (elementUnder) {
                            const newEvent = new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                clientX: clickX,
                                clientY: clickY,
                                button: e.button,
                                buttons: e.buttons
                            });
                            elementUnder.dispatchEvent(newEvent);
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                });
                
                // Добавляем проксирование событий mouseup для UI элементов
                drawingLayer.addEventListener('mouseup', (e) => {
                    if (rulersOverlay.style.display === 'none') return;
                    
                    const clickX = e.clientX;
                    const clickY = e.clientY;
                    
                    // Если mouseup в области панели управления или статус-бара, проксируем событие
                    if (isInPanelArea(clickX, clickY) || isInStatusBarArea(clickX, clickY)) {
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(clickX, clickY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';
                        // Если есть элемент под курсором, отправляем ему событие
                        if (elementUnder) {
                            const newEvent = new MouseEvent('mouseup', {
                                bubbles: true,
                                cancelable: true,
                                clientX: clickX,
                                clientY: clickY,
                                button: e.button,
                                buttons: e.buttons
                            });
                            elementUnder.dispatchEvent(newEvent);
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                });
                
                // Добавляем проксирование событий mouseenter для UI элементов
                let lastHoveredElement = null;
                drawingLayer.addEventListener('mousemove', (e) => {
                    if (rulersOverlay.style.display === 'none') return;
                    
                    const mouseX = e.clientX;
                    const mouseY = e.clientY;
                    
                    // Если курсор в области панели управления или статус-бара, проксируем события hover
                    if (isInPanelArea(mouseX, mouseY) || isInStatusBarArea(mouseX, mouseY)) {
                        // Временно отключаем pointer-events у drawingLayer
                        drawingLayer.style.pointerEvents = 'none';
                        // Получаем элемент под курсором
                        const elementUnder = document.elementFromPoint(mouseX, mouseY);
                        // Восстанавливаем pointer-events
                        drawingLayer.style.pointerEvents = 'auto';
                        
                        // Если элемент изменился, отправляем события mouseleave/mouseenter
                        if (elementUnder !== lastHoveredElement) {
                            // Отправляем mouseleave предыдущему элементу
                            if (lastHoveredElement) {
                                const leaveEvent = new MouseEvent('mouseleave', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: mouseX,
                                    clientY: mouseY
                                });
                                lastHoveredElement.dispatchEvent(leaveEvent);
                            }
                            
                            // Отправляем mouseenter новому элементу
                            if (elementUnder) {
                                const enterEvent = new MouseEvent('mouseenter', {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: mouseX,
                                    clientY: mouseY
                                });
                                elementUnder.dispatchEvent(enterEvent);
                            }
                            
                            lastHoveredElement = elementUnder;
                        }
                        
                        // Всегда отправляем mousemove элементу под курсором
                        if (elementUnder) {
                            const moveEvent = new MouseEvent('mousemove', {
                                bubbles: true,
                                cancelable: true,
                                clientX: mouseX,
                                clientY: mouseY
                            });
                            elementUnder.dispatchEvent(moveEvent);
                        }
                        
                        // Устанавливаем обычный курсор для UI элементов
                        drawingLayer.style.cursor = 'default';
                } else {
                        // Если курсор вышел из области UI, отправляем mouseleave последнему элементу
                        if (lastHoveredElement) {
                            const leaveEvent = new MouseEvent('mouseleave', {
                                bubbles: true,
                                cancelable: true,
                                clientX: mouseX,
                                clientY: mouseY
                            });
                            lastHoveredElement.dispatchEvent(leaveEvent);
                            lastHoveredElement = null;
                        }
                        
                        // Логика изменения курсора для областей рисования
                        const canDrawRect = !isInRulerArea(mouseX, mouseY) && 
                                          !isInPanelArea(mouseX, mouseY) &&
                                          !isNearGuide(mouseX, mouseY) &&
                                          !isNearRectangleEdge(mouseX, mouseY) &&
                                          !isDraggingNewGuide &&
                                          !draggingGuide &&
                                          !drawingRect &&
                                          resizingRectIdx === null;
                        
                        // Изменяем курсор в зависимости от возможности рисования
                        if (canDrawRect) {
                            drawingLayer.style.cursor = 'crosshair';
                        } else if (isInRulerArea(mouseX, mouseY)) {
                            drawingLayer.style.cursor = mouseX <= 24 ? 'ew-resize' : 'ns-resize';
                        } else if (isNearGuide(mouseX, mouseY)) {
                            // Определяем тип ближайшего гайда для курсора
                            let nearVertical = false;
                            for (let guideX of vGuides) {
                                if (Math.abs(mouseX - guideX) <= 5) {
                                    nearVertical = true;
                                    break;
                                }
                            }
                            drawingLayer.style.cursor = nearVertical ? 'ew-resize' : 'ns-resize';
                        } else {
                            drawingLayer.style.cursor = 'default';
                        }
                    }
                });
                
                // Обрабатываем mouseup для создания прямоугольника
                const origWindowMouseUp = window.onmouseup;
                // Удаляем дублирующий обработчик - теперь обрабатывается в объединенном обработчике mouseup

        // === Функция для добавления маркеров изменения размера к прямоугольнику ===
        function addResizeHandles(r, idx) {
            const handles = [
                { pos: 'nw', style: { left: '-4px', top: '-4px', cursor: 'nwse-resize' } },
                { pos: 'n', style: { left: 'calc(50% - 4px)', top: '-4px', cursor: 'ns-resize' } },
                { pos: 'ne', style: { right: '-4px', top: '-4px', cursor: 'nesw-resize' } },
                { pos: 'e', style: { right: '-4px', top: 'calc(50% - 4px)', cursor: 'ew-resize' } },
                { pos: 'se', style: { right: '-4px', bottom: '-4px', cursor: 'nwse-resize' } },
                { pos: 's', style: { left: 'calc(50% - 4px)', bottom: '-4px', cursor: 'ns-resize' } },
                { pos: 'sw', style: { left: '-4px', bottom: '-4px', cursor: 'nesw-resize' } },
                { pos: 'w', style: { left: '-4px', top: 'calc(50% - 4px)', cursor: 'ew-resize' } }
            ];
            
            handles.forEach(h => {
                const handle = document.createElement('div');
                Object.assign(handle.style, {
                    position: 'absolute',
                    width: '8px',
                    height: '8px',
                    background: '#2196f3',
                    border: '1px solid #fff',
                    borderRadius: '0px',
                    zIndex: '2147483649',
                    pointerEvents: 'auto',
                    opacity: '0.8',
                    visibility: 'hidden',
                    ...h.style
                });
                
                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    resizingRectIdx = idx;
                    resizingHandle = h.pos;
                    const rect = drawnRects[idx];
                    
                    resizeStart = {
                        startX: e.clientX,
                        startY: e.clientY,
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    };
                });
                
                r.appendChild(handle);
            });
            
            // Показывать ручки при наведении
            r.addEventListener('mouseenter', () => {
                r.querySelectorAll('div').forEach(handle => {
                    handle.style.visibility = 'visible';
                });
            });
            
            // Скрывать ручки при уходе курсора
            r.addEventListener('mouseleave', () => {
                // Не скрываем ручки если этот прямоугольник изменяется
                if (resizingRectIdx === idx) return;
                
                r.querySelectorAll('div').forEach(handle => {
                    handle.style.visibility = 'hidden';
                });
            });
        }

        // Обновляем функцию renderGuides для создания прямоугольников с расширенной функциональностью
        function renderGuides() {
            guidesContainer.innerHTML = '';
            // Вертикальные
            vGuides.forEach((x, i) => {
                const g = document.createElement('div');
                Object.assign(g.style, {
                    position: 'fixed',
                    left: (x - 5) + 'px',  // Смещаем влево на 5px для увеличения области клика
                    top: '0',
                    width: '10px',  // Увеличенная ширина для удобства клика
                    height: '100vh',
                    background: 'transparent',  // Делаем фон прозрачным
                    zIndex: '2147483647',
                    cursor: 'ew-resize',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    boxShadow: selectedGuides.v.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                
                // Добавляем внутреннюю линию для визуального отображения
                const innerLine = document.createElement('div');
                Object.assign(innerLine.style, {
                    position: 'absolute',
                        left: '4.5px',  // Центрируем 1px линию в 10px контейнере
                    top: '0',
                        width: '1px',  // Уменьшенная ширина линии
                    height: '100%',
                    background: selectedGuides.v.includes(i) ? 'rgba(255,200,0,0.95)' : 'rgba(0,200,255,0.7)',
                    pointerEvents: 'none',  // Линия не мешает кликам
                    boxShadow: selectedGuides.v.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                g.appendChild(innerLine);
                
                g.title = 'Перетащите для перемещения, двойной клик — удалить, клик — выбрать для измерения';
                g.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    draggingGuide = g;
                    dragType = 'v';
                    dragIndex = i;
                    dragStart = e.clientX;
                    dragOrig = x;
                    document.body.style.cursor = 'ew-resize';
                    e.preventDefault();
                });
                g.addEventListener('dblclick', (e) => {
                    vGuides.splice(i, 1);
                    saveGuides();
                    renderGuides();
                    clearDistanceLabel();
                    e.stopPropagation();
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedGuides.v.length === 0) {
                        selectedGuides.v = [i];
                        renderGuides();
                    } else if (selectedGuides.v.length === 1 && selectedGuides.v[0] !== i) {
                        selectedGuides.v.push(i);
                        renderGuides();
                        showDistanceLabel('v', selectedGuides.v[0], selectedGuides.v[1]);
                    } else {
                        clearDistanceLabel();
                        renderGuides();
                    }
                });
                guidesContainer.appendChild(g);
            });
            // Горизонтальные
            hGuides.forEach((y, i) => {
                const g = document.createElement('div');
                Object.assign(g.style, {
                    position: 'fixed',
                    left: '0',
                    top: (y - 5) + 'px',  // Смещаем вверх на 5px для увеличения области клика
                    width: '100vw',  // Увеличенная высота для удобства клика
                    height: '10px',  // Увеличенная высота для удобства клика
                    background: 'transparent',  // Делаем фон прозрачным
                    zIndex: '2147483647',
                    cursor: 'ns-resize',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    boxShadow: selectedGuides.h.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                
                // Добавляем внутреннюю линию для визуального отображения
                const innerLine = document.createElement('div');
                Object.assign(innerLine.style, {
                    position: 'absolute',
                    left: '0',
                        top: '4.5px',  // Центрируем 1px линию в 10px контейнере
                    width: '100%',
                        height: '1px',  // Уменьшенная высота линии
                    background: selectedGuides.h.includes(i) ? 'rgba(255,200,0,0.95)' : 'rgba(0,200,255,0.7)',
                    pointerEvents: 'none',  // Линия не мешает кликам
                    boxShadow: selectedGuides.h.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                g.appendChild(innerLine);
                
                g.title = 'Перетащите для перемещения, двойной клик — удалить, клик — выбрать для измерения';
                g.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    draggingGuide = g;
                    dragType = 'h';
                    dragIndex = i;
                    dragStart = e.clientY;
                    dragOrig = y;
                    document.body.style.cursor = 'ns-resize';
                    e.preventDefault();
                });
                g.addEventListener('dblclick', (e) => {
                    hGuides.splice(i, 1);
                    saveGuides();
                    renderGuides();
                    clearDistanceLabel();
                    e.stopPropagation();
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedGuides.h.length === 0) {
                        selectedGuides.h = [i];
                        renderGuides();
                    } else if (selectedGuides.h.length === 1 && selectedGuides.h[0] !== i) {
                        selectedGuides.h.push(i);
                        renderGuides();
                        showDistanceLabel('h', selectedGuides.h[0], selectedGuides.h[1]);
                    } else {
                        clearDistanceLabel();
                        renderGuides();
                    }
                });
                guidesContainer.appendChild(g);
            });
            // Прямоугольники
            drawnRects.forEach((rect, idx) => {
                const r = document.createElement('div');
                Object.assign(r.style, {
                    position: 'fixed',
                    left: rect.left + 'px',
                    top: rect.top + 'px',
                    width: rect.width + 'px',
                    height: rect.height + 'px',
                    border: '1.5px solid #2196f3',
                    background: rect.color,
                    zIndex: '2147483648',
                    pointerEvents: 'auto',
                    borderRadius: '0px',
                    boxSizing: 'border-box',
                    outline: (resizingRectIdx === idx) ? '1px solid rgba(33, 150, 243, 0.5)' : (movingRectIdx === idx ? '1px solid rgba(255, 152, 0, 0.5)' : 'none'),
                    userSelect: 'none',
                    overflow: 'visible',
                    cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    });
                    
                    // Создаем текстовую метку с размерами
                    const sizeLabel = document.createElement('div');
                    sizeLabel.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
                    Object.assign(sizeLabel.style, {
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: '#2196f3',
                        background: 'rgba(255, 255, 255, 0.9)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        border: '1px solid #2196f3',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontFamily: 'Arial, sans-serif',
                        lineHeight: '1',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        zIndex: '2147483649'
                    });
                    
                    // Добавляем метку в прямоугольник
                    r.appendChild(sizeLabel);
                
                // Удаление по двойному клику
                r.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    drawnRects.splice(idx, 1);
                    renderGuides();
                });
                
                // Перемещение прямоугольника только для копирования с Shift
                r.addEventListener('mousedown', (e) => {
                    // Если клик не на самом прямоугольнике (например, на маркере), игнорируем
                    if (e.target !== r) return;
                    
                    // Если Shift зажат - копируем прямоугольник
                    if (e.shiftKey) {
                        e.stopPropagation();
                        const newRect = { ...rect };
                        newRect.left += 20;
                        newRect.top += 20;
                        drawnRects.push(newRect);
                        renderGuides();
                        return;
                    }
                    
                    // Стандартное перемещение теперь обрабатывается через makeRectDraggable
                });
                
                // Добавляем маркеры для изменения размера
                addResizeHandles(r, idx);
                
                // Добавляем возможность перетаскивания через makeRectDraggable
                makeRectDraggable(r, idx);
                
                guidesContainer.appendChild(r);
            });
            
            // Метки расстояния и временные элементы
            if (distanceLabel) guidesContainer.appendChild(distanceLabel);
            if (drawingRect && drawingRect.parentNode == null) {
                guidesContainer.appendChild(drawingRect);
            }
        }

        // Сброс выбора при клике вне гайдов
        guidesContainer.addEventListener('click', (e) => {
            clearDistanceLabel();
            renderGuides();
        });
        window.addEventListener('mousemove', (e) => {
            // === RESIZE RECT ===
            if (resizingRectIdx !== null && resizingHandle !== null && resizeStart) {
                const rect = drawnRects[resizingRectIdx];
                let dx = e.clientX - resizeStart.startX;
                let dy = e.clientY - resizeStart.startY;
                let newRect = Object.assign({}, rect);
                if (resizingHandle === 'nw') {
                    newRect.left = resizeStart.left + dx;
                    newRect.top = resizeStart.top + dy;
                    newRect.width = resizeStart.width - dx;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'ne') {
                    newRect.top = resizeStart.top + dy;
                    newRect.width = resizeStart.width + dx;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'sw') {
                    newRect.left = resizeStart.left + dx;
                    newRect.width = resizeStart.width - dx;
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'se') {
                    newRect.width = resizeStart.width + dx;
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'n') {
                    newRect.top = resizeStart.top + dy;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'e') {
                    newRect.width = resizeStart.width + dx;
                } else if (resizingHandle === 's') {
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'w') {
                    newRect.left = resizeStart.left + dx;
                    newRect.width = resizeStart.width - dx;
                }
                // Минимальный размер
                if (newRect.width < 10) newRect.width = 10;
                if (newRect.height < 10) newRect.height = 10;
                drawnRects[resizingRectIdx] = newRect;
                renderGuides();
                return;
            }
            // === DRAG GUIDE ===
            if (draggingGuide) {
                if (dragType === 'v') {
                    let nx = dragOrig + (e.clientX - dragStart);
                    nx = Math.max(0, Math.min(window.innerWidth - 1, nx));
                    vGuides[dragIndex] = nx;
                } else if (dragType === 'h') {
                    let ny = dragOrig + (e.clientY - dragStart);
                    ny = Math.max(0, Math.min(window.innerHeight - 1, ny));
                    hGuides[dragIndex] = ny;
                }
                renderGuides();
                clearDistanceLabel();
                return;
            }
            // ... остальные действия (например, рисование прямоугольника) ...
        });
        window.addEventListener('mouseup', (e) => {
            // === RESIZE RECT ===
            if (resizingRectIdx !== null) {
                resizingRectIdx = null;
                resizingHandle = null;
                resizeStart = null;
                return;
            }
            if (draggingGuide) {
                saveGuides();
                draggingGuide = null;
                dragType = null;
                dragIndex = -1;
                document.body.style.cursor = '';
            }
        });
        // Перерисовка линеек
        function drawRulers() {
            // Горизонтальная
            rulerH.width = window.innerWidth;
            rulerH.height = 24;
            const ctxH = rulerH.getContext('2d');
            ctxH.clearRect(0, 0, rulerH.width, rulerH.height);
            
            // Используем булевую переменную вместо сравнения строк
            
            // Выбираем цвет линий и текста в зависимости от наведения
            ctxH.fillStyle = isRulerHHovered ? 'rgba(34,34,34,0.3)' : 'rgba(34,34,34,0.01)';
            ctxH.fillRect(0, 0, rulerH.width, 24);
            ctxH.strokeStyle = isRulerHHovered ? 'rgba(120,120,120,0.8)' : 'rgba(170,170,170,0.03)';
            
            for (let x = 0; x < rulerH.width; x += 10) {
                ctxH.beginPath();
                ctxH.moveTo(x + 0.5, 24);
                ctxH.lineTo(x + 0.5, x % 100 === 0 ? 4 : (x % 50 === 0 ? 10 : 16));
                ctxH.stroke();
                if (x % 50 === 0) {
                    ctxH.fillStyle = isRulerHHovered ? 'rgba(255,255,255,0.8)' : 'rgba(170,170,170,0.03)';
                    ctxH.font = 'bold 10px Arial';
                    ctxH.fillText(x.toString(), x + 2, 12);
                }
            }
            
            // Вертикальная
            rulerV.width = 24;
            rulerV.height = window.innerHeight;
            const ctxV = rulerV.getContext('2d');
            ctxV.clearRect(0, 0, 24, rulerV.height);
            
            // Используем булевую переменную вместо сравнения строк
            
            // Выбираем цвет линий и текста в зависимости от наведения
            ctxV.fillStyle = isRulerVHovered ? 'rgba(34,34,34,0.3)' : 'rgba(34,34,34,0.01)';
            ctxV.fillRect(0, 0, 24, rulerV.height);
            ctxV.strokeStyle = isRulerVHovered ? 'rgba(120,120,120,0.8)' : 'rgba(170,170,170,0.03)';
            
            for (let y = 0; y < rulerV.height; y += 10) {
                ctxV.beginPath();
                ctxV.moveTo(24, y + 0.5);
                ctxV.lineTo(y % 100 === 0 ? 4 : (y % 50 === 0 ? 10 : 16), y + 0.5);
                ctxV.stroke();
                if (y % 50 === 0) {
                    ctxV.fillStyle = isRulerVHovered ? 'rgba(255,255,255,0.8)' : 'rgba(170,170,170,0.03)';
                    ctxV.font = 'bold 10px Arial';
                    ctxV.fillText(y.toString(), 2, y + 10);
                }
            }
            
            // Рисуем вертикальные гайды на rulerH
            ctxH.strokeStyle = '#00eaff';
            vGuides.forEach(x => {
                ctxH.beginPath();
                ctxH.moveTo(x + 0.5, 0);
                ctxH.lineTo(x + 0.5, 24);
                ctxH.stroke();
            });
            
            // Рисуем горизонтальные гайды на rulerV
            ctxV.strokeStyle = '#00eaff';
            hGuides.forEach(y => {
                ctxV.beginPath();
                ctxV.moveTo(0, y + 0.5);
                ctxV.lineTo(24, y + 0.5);
                ctxV.stroke();
            });
        }
        window.addEventListener('resize', () => {
            drawRulers();
            renderGuides();
        });
        // Показывать/скрывать guidesContainer вместе с rulersOverlay
        rulersBtn.addEventListener('click', () => {
            if (rulersOverlay.style.display === 'none') {
                rulersOverlay.style.display = 'block';
                guidesContainer.style.display = 'block';
                    drawingLayer.style.display = 'block'; // Показываем слой для рисования
                drawRulers();
                renderGuides();
                
                // Активируем режим редактирования баннера
                window.isRulersActive = true;
                window.isBannerEditModeActive = true;
                
                // Обновляем цвет кнопки
                updateRulersBtnColor();
            } else {
                rulersOverlay.style.display = 'none';
                guidesContainer.style.display = 'none';
                    drawingLayer.style.display = 'none'; // Скрываем слой для рисования
                
                // Деактивируем режим линеек
                window.isRulersActive = false;
                // Проверяем, остался ли активным режим изменения ширины
                window.isBannerEditModeActive = window.isWidthControlActive === true;
                
                // Обновляем цвет кнопки
                updateRulersBtnColor();
            }
        });

        panel.appendChild(btnContainer);
        document.body.appendChild(panel);

        // Вспомогательные функции для drag и выбора
        let draggingGuide = null;
        let dragType = null; // 'h' | 'v'
        let dragIndex = -1;
        let dragStart = 0;
        let dragOrig = 0;
        // Для выбора двух гайдов и отображения расстояния
        let selectedGuides = { h: [], v: [] };
        let distanceLabel = null;
        function clearDistanceLabel() {
            if (distanceLabel && distanceLabel.parentNode) distanceLabel.parentNode.removeChild(distanceLabel);
            distanceLabel = null;
            selectedGuides = { h: [], v: [] };
        }
        function showDistanceLabel(type, idx1, idx2) {
            clearDistanceLabel();
            if (type !== 'h' && type !== 'v') return;
            let pos1 = (type === 'h' ? hGuides[idx1] : vGuides[idx1]);
            let pos2 = (type === 'h' ? hGuides[idx2] : vGuides[idx2]);
            let d = Math.abs(pos2 - pos1);
            // Создаём метку
            distanceLabel = document.createElement('div');
            distanceLabel.textContent = d + ' px';
            Object.assign(distanceLabel.style, {
                position: 'fixed',
                zIndex: '2147483648',
                background: 'rgba(0,0,0,0.85)',
                color: '#fff',
                fontSize: '13px',
                padding: '2px 8px',
                borderRadius: '6px',
                pointerEvents: 'none',
                fontWeight: 'bold',
                boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                userSelect: 'none',
                letterSpacing: '0.5px',
            });
            if (type === 'v') {
                // Вертикальные: метка по центру между x1 и x2, сверху
                let x = (pos1 + pos2) / 2;
                distanceLabel.style.left = (x - 24) + 'px';
                distanceLabel.style.top = '28px';
            } else {
                // Горизонтальные: метка по центру между y1 и y2, слева
                let y = (pos1 + pos2) / 2;
                distanceLabel.style.left = '32px';
                distanceLabel.style.top = (y - 12) + 'px';
            }
            guidesContainer.appendChild(distanceLabel);
        }

        // Функция для добавления возможности перетаскивания прямоугольника
        function makeRectDraggable(element, idx) {
            let isDragging = false;
            let offsetX, offsetY;
            
            // Заменяем глобальный слушатель, добавляем прослушивание только на сам элемент
            element.addEventListener('mousedown', (e) => {
                // Если клик не на самом прямоугольнике (например, на маркере), игнорируем
                if (e.target !== element) return;
                
                // Если Shift зажат - копируем прямоугольник (эта функциональность уже реализована в обработчике)
                if (e.shiftKey) return;
                
                // Проверяем, не перемещаем ли мы уже этот прямоугольник через другой механизм
                if (movingRectIdx === idx) return;
                
                // Обычное перемещение
                isDragging = true;
                offsetX = e.clientX - parseInt(element.style.left);
                offsetY = e.clientY - parseInt(element.style.top);
                
                // Добавляем визуальную обратную связь
                element.style.cursor = 'move';
                e.stopPropagation(); // Предотвращаем создание нового прямоугольника
            });
            
            const moveHandler = (e) => {
                if (isDragging) {
                    const newLeft = e.clientX - offsetX;
                    const newTop = e.clientY - offsetY;
                    
                    // Обновляем DOM элемент
                    element.style.left = `${newLeft}px`;
                    element.style.top = `${newTop}px`;
                    
                    // Синхронизируем с данными в массиве прямоугольников
                    if (drawnRects[idx]) {
                        drawnRects[idx].left = newLeft;
                        drawnRects[idx].top = newTop;
                    }
                    
                    e.preventDefault();
                }
            };
            
            const upHandler = () => {
                if (isDragging) {
                    isDragging = false;
                    element.style.cursor = 'grab';
                }
            };
            
            // Используем capture фазу для событий
            document.addEventListener('mousemove', moveHandler, true);
            document.addEventListener('mouseup', upHandler, true);
            
            // Удаляем слушателей при удалении из DOM
            element.addEventListener('remove', () => {
                document.removeEventListener('mousemove', moveHandler, true);
                document.removeEventListener('mouseup', upHandler, true);
            });
        }

            // Добавляем визуальные подсказки при наведении мыши
            // ЗАМЕНЕН НА ОБЪЕДИНЕННЫЙ ОБРАБОТЧИК ВЫШЕ
            /* drawingLayer.addEventListener('mousemove', (e) => {
                if (rulersOverlay.style.display === 'none') return;
                
                const mouseX = e.clientX;
                const mouseY = e.clientY;
                
                // Определяем, можно ли рисовать прямоугольник в данной позиции
                const canDrawRect = !isInRulerArea(mouseX, mouseY) && 
                                  !isInPanelArea(mouseX, mouseY) &&
                                  !isInStatusBarArea(mouseX, mouseY) &&
                                  !isNearGuide(mouseX, mouseY) &&
                                  !isNearRectangleEdge(mouseX, mouseY) &&
                                  !isDraggingNewGuide &&
                                  !draggingGuide &&
                                  !drawingRect &&
                                  resizingRectIdx === null;
                
                // Изменяем курсор в зависимости от возможности рисования
                if (canDrawRect) {
                    drawingLayer.style.cursor = 'crosshair';
                } else if (isInRulerArea(mouseX, mouseY)) {
                    drawingLayer.style.cursor = mouseX <= 24 ? 'ew-resize' : 'ns-resize';
                } else if (isInPanelArea(mouseX, mouseY)) {
                    drawingLayer.style.cursor = 'default'; // Обычный курсор над панелью
                } else if (isInStatusBarArea(mouseX, mouseY)) {
                    drawingLayer.style.cursor = 'default'; // Обычный курсор над статус-баром
                } else if (isNearGuide(mouseX, mouseY)) {
                    // Определяем тип ближайшего гайда для курсора
                    let nearVertical = false;
                    for (let guideX of vGuides) {
                        if (Math.abs(mouseX - guideX) <= 5) {
                            nearVertical = true;
                            break;
                        }
                    }
                    drawingLayer.style.cursor = nearVertical ? 'ew-resize' : 'ns-resize';
                } else {
                    drawingLayer.style.cursor = 'default';
                }
            });
            
            drawingLayer.addEventListener('mouseleave', () => {
                drawingLayer.style.cursor = 'default';
            }); */
        } // Закрываем функцию initializePanelComponents
        
        // Запускаем проверку контейнера
        checkAnimationContainer();
    } // Закрываем функцию initAnimatePanel

    // === СИСТЕМА МОНИТОРИНГА И АВТОМАТИЧЕСКОГО ПЕРЕЗАПУСКА ===
    
    // Глобальная переменная для предотвращения повторного запуска
    const SCRIPT_INSTANCE_KEY = 'aniplay_script_running';
    
    // Проверяем, не запущен ли уже другой экземпляр скрипта
    if (window[SCRIPT_INSTANCE_KEY]) {
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Скрипт уже запущен, прекращение инициализации текущего экземпляра`);
        return;
    }
    
    // Отмечаем что скрипт запущен
    window[SCRIPT_INSTANCE_KEY] = true;
    console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Инициализация системы мониторинга...`);
    
    // Глобальные переменные для отслеживания состояния
    let isScriptInitialized = false;
    let isScriptInitializing = false; // Новый флаг для предотвращения одновременной инициализации
    let monitoringInterval = null;
    let consecutiveChecks = 0;
    const MAX_CONSECUTIVE_CHECKS = 5;
    const CHECK_INTERVAL_MS = 2000;
    
    // Функция проверки наличия баннера Adobe Animate
    function checkAnimateBannerExists() {
        // Проверяем наличие контейнера анимации
        const animationContainer = document.getElementById('animation_container');
        if (!animationContainer) {
            return false;
        }
        
        // Проверяем наличие createjs объектов
        if (typeof createjs === 'undefined' || 
            !createjs.Ticker || 
            typeof createjs.Ticker.framerate !== 'number') {
            return false;
        }
        
        // Проверяем наличие exportRoot
        if (typeof window.exportRoot === 'undefined') {
            return false;
        }
        
        console.log('[AniPlay Monitor] Баннер Adobe Animate обнаружен');
        return true;
    }
    
    // Функция проверки, запущен ли скрипт (есть ли панель)
    function checkScriptRunning() {
        // Первичная проверка глобальной переменной
        if (!window[SCRIPT_INSTANCE_KEY]) {
            return false;
        }
        
        // Улучшенный поиск панели с более точными критериями
        const existingPanels = document.querySelectorAll('div[style*="position: fixed"]');
        for (let panel of existingPanels) {
            // Проверяем наличие уникального класса или атрибутов нашей панели
            if (panel.style.zIndex === '9999' && 
                (panel.querySelector('input[type="range"].frame-slider') ||
                 panel.querySelector('button[title*="FPS"]') ||
                 panel.querySelector('div[style*="font-weight: bold"][style*="color: #fff"]'))) {
                console.log('[AniPlay Monitor] Обнаружена существующая панель');
                return true;
            }
        }
        
        // Дополнительная проверка по уникальному идентификатору
        if (document.querySelector('.aniplay-panel')) {
            console.log('[AniPlay Monitor] Найдена панель по классу');
            return true;
        }
        
        return false;
    }
    
    // Функция проверки успешного запуска панели на странице с баннером
    function checkPanelSuccessfullyLaunched() {
        const bannerExists = checkAnimateBannerExists();
        const scriptRunning = checkScriptRunning();
        
        // Если баннер есть, то скрипт должен работать
        if (bannerExists && !scriptRunning) {
            return false; // Неуспешный запуск - баннер есть, но панель не работает
        }
        
        // Если баннера нет, то проверка не нужна
        if (!bannerExists) {
            return true; // Считаем "успешным" - нет баннера, нет необходимости в панели
        }
        
        // Баннер есть и скрипт работает - успех
        return true;
    }
    
    // Функция мониторинга
    function monitorScriptState() {
        const scriptRunning = checkScriptRunning();
        
        console.log(`[AniPlay Monitor] Проверка ${consecutiveChecks + 1}/${MAX_CONSECUTIVE_CHECKS}: Скрипт=${scriptRunning}`);
        
        if (!scriptRunning) {
            consecutiveChecks++;
            
            if (consecutiveChecks >= MAX_CONSECUTIVE_CHECKS) {
                console.log('[AniPlay Monitor] Скрипт не запущен, попытка перезапуска...');
                initializeScript();
                return;
            }
        } else {
            // Сбрасываем счетчик если скрипт работает
            consecutiveChecks = 0;
            
            // Если скрипт работает, отмечаем как инициализированный
            if (scriptRunning) {
                isScriptInitialized = true;
            }
        }
    }
    
    // Функция запуска мониторинга
    function startMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
        
        console.log('[AniPlay Monitor] Запуск системы мониторинга...');
        monitoringInterval = setInterval(monitorScriptState, CHECK_INTERVAL_MS);
    }
    
    // Основная точка входа с мониторингом
    function mainEntry() {
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Запуск скрипта...`);
        
        // Дополнительная проверка на уже запущенный скрипт
        if (checkScriptRunning()) {
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Скрипт уже запущен, отмена запуска нового экземпляра`);
            return;
        }
        
        // Инициализируем скрипт напрямую без проверки баннера
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Инициализация скрипта...`);
        initializeScript();
    }
    
    // Запуск при загрузке страницы
    if (document.readyState === 'loading') {
        window.addEventListener('load', mainEntry);
    } else {
        // Если страница уже загружена
        mainEntry();
    }
    
    // Дополнительная проверка при изменении DOM (для SPA)
    let domObserver = null;
    if (window.MutationObserver) {
        domObserver = new MutationObserver((mutations) => {
            let shouldCheck = false;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Проверяем, добавились ли элементы связанные с Adobe Animate
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) { // Element node
                            if (node.id === 'animation_container' || 
                                node.id === 'canvas' ||
                                (node.querySelector && (
                                    node.querySelector('#animation_container') ||
                                    node.querySelector('#canvas')
                                ))) {
                                shouldCheck = true;
                            }
                        }
                    });
                }
            });
            
            // Проверяем состояние скрипта при обнаружении элементов баннера
            if (shouldCheck) {
                console.log('[AniPlay Monitor] Обнаружены элементы баннера в DOM, проверка состояния...');
                setTimeout(() => {
                    // Дополнительные проверки перед попыткой инициализации
                    if (isScriptInitializing) {
                        console.log('[AniPlay Monitor] Инициализация уже выполняется, пропуск DOM обработки');
                        return;
                    }
                    
                    if (checkScriptRunning()) {
                        console.log('[AniPlay Monitor] Скрипт уже запущен, пропуск DOM обработки');
                        return;
                    }
                    
                    const bannerExists = checkAnimateBannerExists();
                    const scriptRunning = checkScriptRunning();
                    
                    console.log(`[AniPlay Monitor] DOM изменился: Баннер=${bannerExists}, Скрипт=${scriptRunning}, Инициализирован=${isScriptInitialized}`);
                    
                    // Если баннер появился и скрипт не работает И не инициализирован - пытаемся инициализировать
                    if (bannerExists && !scriptRunning && !isScriptInitialized && !isScriptInitializing) {
                        console.log('[AniPlay Monitor] Баннер появился, скрипт не работает - попытка инициализации через DOM...');
                        initializeScript();
                    }
                }, 1000);
            }
        });
        
        domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // УДАЛЕН дублирующий обработчик load - уже есть в mainEntry()
    // window.addEventListener('load', () => {
    //     waitForCreatejsTickerAndInitPanel();
    // });

    // Функция инициализации скрипта
    function initializeScript() {
        // Блокируем одновременную инициализацию
        if (isScriptInitializing) {
            console.log('[AniPlay Monitor] Инициализация уже выполняется, ожидание...');
            return;
        }
        
        // Проверяем еще раз перед инициализацией
        if (checkScriptRunning()) {
            console.log('[AniPlay Monitor] Скрипт уже запущен, пропуск инициализации');
            return;
        }
        
        // Проверяем флаг инициализации
        if (isScriptInitialized) {
            console.log('[AniPlay Monitor] Скрипт уже инициализирован, пропуск повторной инициализации');
            return;
        }
        
        console.log('[AniPlay Monitor] Начало инициализации скрипта...');
        isScriptInitializing = true; // Устанавливаем флаг инициализации
        isScriptInitialized = true;
        consecutiveChecks = 0;
        
        // Останавливаем мониторинг на время инициализации
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
        
        // Запускаем основную функцию
        waitForCreatejsTickerAndInitPanel();
        
        // Снимаем флаг инициализации через небольшую задержку
        setTimeout(() => {
            isScriptInitializing = false;
            console.log('[AniPlay Monitor] Инициализация завершена');
            
            // Перезапускаем мониторинг через дополнительную задержку, но только если есть баннер
            setTimeout(() => {
                if (checkAnimateBannerExists()) {
                    startMonitoring();
                } else {
                    console.log('[AniPlay Monitor] Баннер не обнаружен, мониторинг не запускается');
                }
            }, 3000);
        }, 2000);
    }
    
    // Функция очистки при завершении работы
    function cleanupScript() {
        console.log('[AniPlay Monitor] Очистка скрипта...');
        window[SCRIPT_INSTANCE_KEY] = false;
        isScriptInitialized = false;
        isScriptInitializing = false; // Очищаем и флаг инициализации
        
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
    }
    
    // Обработчик закрытия страницы
    window.addEventListener('beforeunload', cleanupScript);
    
    // Обработчик видимости страницы (для SPA)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Страница скрыта, но не закрыта - не очищаем
            console.log('[AniPlay Monitor] Страница скрыта');
        } else {
            // Страница стала видимой
            console.log('[AniPlay Monitor] Страница стала видимой');
        }
    });
    
    // Функция мониторинга
    function monitorScriptState() {
        const bannerExists = checkAnimateBannerExists();
        const scriptRunning = checkScriptRunning();
        const panelLaunched = checkPanelSuccessfullyLaunched();
        
        console.log(`[AniPlay Monitor] Проверка ${consecutiveChecks + 1}/${MAX_CONSECUTIVE_CHECKS}: Баннер=${bannerExists}, Скрипт=${scriptRunning}, Успешный_запуск=${panelLaunched}`);
        
        // Если нет баннера - останавливаем мониторинг
        if (!bannerExists) {
            console.log('[AniPlay Monitor] Баннер не обнаружен, остановка мониторинга');
            if (monitoringInterval) {
                clearInterval(monitoringInterval);
                monitoringInterval = null;
            }
            return;
        }
        
        // Если есть баннер, но панель не запущена
        if (!panelLaunched) {
            consecutiveChecks++;
            
            if (consecutiveChecks >= MAX_CONSECUTIVE_CHECKS) {
                console.log('[AniPlay Monitor] Панель не запущена на странице с баннером, попытка перезапуска...');
                isScriptInitialized = false; // Сбрасываем флаг для возможности перезапуска
                initializeScript();
                return;
            }
        } else {
            // Сбрасываем счетчик если все работает корректно
            consecutiveChecks = 0;
            
            // Если панель успешно запущена, отмечаем как инициализированную
            if (panelLaunched) {
                isScriptInitialized = true;
            }
        }
    }
    
    // Функция запуска мониторинга
    function startMonitoring() {
        // Запускаем мониторинг только если есть баннер
        if (!checkAnimateBannerExists()) {
            console.log('[AniPlay Monitor] Баннер не обнаружен, мониторинг не запускается');
            return;
        }
        
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
        
        console.log('[AniPlay Monitor] Запуск системы мониторинга...');
        monitoringInterval = setInterval(monitorScriptState, CHECK_INTERVAL_MS);
    }
    
    // Основная точка входа с мониторингом
    function mainEntry() {
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Запуск скрипта...`);
        
        // Дополнительная проверка на уже запущенный скрипт
        if (checkScriptRunning()) {
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Скрипт уже запущен, отмена запуска нового экземпляра`);
            return;
        }
        
        // Проверяем наличие баннера
        const bannerExists = checkAnimateBannerExists();
        console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Баннер обнаружен: ${bannerExists}`);
        
        if (bannerExists) {
            // Если есть баннер - инициализируем скрипт и запускаем мониторинг
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Инициализация скрипта для страницы с баннером...`);
            initializeScript();
        } else {
            // Если нет баннера - просто пытаемся инициализировать один раз без мониторинга
            console.log(`[AniPlay Monitor v${SCRIPT_VERSION}] Страница без баннера, разовая попытка инициализации...`);
            waitForCreatejsTickerAndInitPanel();
        }
    }
})();

