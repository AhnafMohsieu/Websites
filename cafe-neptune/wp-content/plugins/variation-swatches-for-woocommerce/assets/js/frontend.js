;(function ($) {
    'use strict';

    /**
     * Is there at least one in-stock, purchasable variation that matches the
     * given attribute value combined with the attributes already chosen?
     *
     * Drives stock-aware swatch greying independently of the WooCommerce
     * "Hide out of stock items" setting. An attribute value in a variation is
     * treated as a wildcard when it is empty (the "any" value).
     *
     * @param {string} attrName   e.g. "attribute_pa_size"
     * @param {string} value      term slug for this swatch
     * @param {Object} chosen     map of attribute_name -> selected slug
     * @param {Array}  variations variation data (is_in_stock/is_purchasable per item)
     * @returns {boolean} true when no data is available, so existing behavior stands
     */
    function matchingVariationInStock(attrName, value, chosen, variations) {
        if (!Array.isArray(variations)) {
            return true;
        }

        return variations.some(function (variation) {
            if (!(variation.is_in_stock && variation.is_purchasable)) {
                return false;
            }

            var attrs = variation.attributes || {};

            // This attribute must match the swatch value (or be a wildcard).
            var ownValue = attrs[attrName];
            if (typeof ownValue !== 'undefined' && ownValue !== '' && ownValue !== value) {
                return false;
            }

            // Every other already-selected attribute must match (or be a wildcard).
            for (var key in chosen) {
                if (key === attrName || !chosen.hasOwnProperty(key)) {
                    continue;
                }
                var otherValue = attrs[key];
                if (typeof otherValue !== 'undefined' && otherValue !== '' && otherValue !== chosen[key]) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * SIMPLIFIED: Original variation swatches form - PHP-only optimized
     * No AJAX delays, no loading states, instant response
     */
    $.fn.tawcvs_variation_swatches_form = function () {
        return this.each(function () {
            var $form = $(this);

            // OPTIMIZED: All data is loaded upfront by PHP, no special handling needed
            if (typeof $form.find(".tawcvs-available-product-variation").data("product_variations") !== "undefined") {
                $form.data("product_variations", $form.find(".tawcvs-available-product-variation").data("product_variations"))
                    .trigger('reload_product_variations')
                    .trigger('update_variation_values');
            }

            $form
                .addClass('swatches-support')
                .on("found_variation", function (event, variation) {
                    $form.change_variation_image_on_shop_page(variation);
                })
                .on("reset_image", function (event) {
                    $form.change_variation_image_on_shop_page(false);
                })
                .on('click', '.swatch', function (e) {
                    e.preventDefault();
                    e.stopImmediatePropagation();

                    var $el = $(this);
                    let $select = false, value = false;

                    // PERFORMANCE: Quick debounce for rapid clicks
                    if ($el.data('clicking')) return;
                    $el.data('clicking', true);
                    setTimeout(() => $el.removeData('clicking'), 50);

                    if (!$("body").hasClass("single-product") &&
                        $("body").find(".wc-product-table-wrapper").length) {
                        //For product table page
                        let attribute_name = $el.closest('.tawcvs-swatches').data("attribute_name");
                        $select = $el.closest('.variations').find('select[data-attribute_name="' + attribute_name + '"]');
                        value = $el.attr('data-value');
                    } else {
                        //For normal variable product page
                        $select = $el.closest('.value').find('select');
                        value = $el.attr('data-value');
                    }

                    if ($el.hasClass('disabled')) {
                        return;
                    }

                    //Woo product bundle plugin uses "select" class instead of "value" class
                    if (!$select.length) {
                        if ($form.closest(".woosb-product").length) {
                            $select = $el.closest('.select').find('select');
                        }
                    }

                    //Disabling other swatches, then resetting the select value to empty
                    $el.parents('.tawcvs-swatches').find(".swatch.selected").each(function () {
                        $(this).not($el).removeClass("selected");
                        $select.val('');
                    })

                    // For old WC
                    $select.trigger('focusin');

                    // Check if this combination is available
                    if (!$select.find('option[value="' + value + '"]').length) {
                        $el.siblings('.swatch').removeClass('selected');
                        $select.val('').change();
                        $form.trigger('tawcvs_no_matching_variations', [$el]);
                        return;
                    }

                    if ($el.hasClass('selected')) {
                        $select.val('');
                        $el.removeClass('selected');

                        if ($el.attr('type') == 'radio') {
                            setTimeout(function() {
                                $el.prop('checked', false);
                            }, 100);
                        }
                    } else {
                        $el.addClass('selected').siblings('.selected').removeClass('selected');
                        $select.val(value);

                        if ($el.attr('type') == 'radio') {
                            setTimeout(function() {
                                $el.prop('checked', true);
                            }, 100);
                        }
                    }

                    $select.change();
                })
                .on('click', '.reset_variations', function () {
                    $form.find('.swatch.selected').removeClass('selected');
                    if( !$form.find('.swatch.disabled').hasClass('blur-cross') ){
                        $form.find('.swatch.disabled').removeClass('disabled');
                    }

                    if ($form.find('input[type="radio"]').length > 1) {
                        $form.find('input[type="radio"]').prop('checked', false);
                    }
                })
                .on('woocommerce_update_variation_values', function () {
                    // OPTIMIZED: Efficient variation value updates
                    setTimeout(function () {
                        // Stock-aware data: works regardless of the WooCommerce
                        // "Hide out of stock items" setting. Bails (returns "available")
                        // when no variation data is present so existing behavior stands.
                        var variations = $form.data('product_variations');

                        // Attributes the shopper has currently selected.
                        var chosen = {};
                        $form.find('.variation-selector select').each(function () {
                            var name = $(this).data('attribute_name') || $(this).attr('name'),
                                val = $(this).val();
                            if (name && val) {
                                chosen[name] = val;
                            }
                        });

                        $form.find('.variation-selector').each(function () {
                            var $variationSelector = $(this),
                                $select = $variationSelector.find('select'),
                                $options = $select.find('option'),
                                $selected = $options.filter(':selected'),
                                attrName = $select.data('attribute_name') || $select.attr('name'),
                                values = [];

                            $options.each(function (index, option) {
                                if (option.value !== '') {
                                    values.push(option.value);
                                }
                            });

                            $variationSelector.closest('.value').find('.swatch').each(function () {
                                var $swatch = $(this),
                                    value = $swatch.attr('data-value');

                                $swatch.closest('.swatch-item-wrapper').show();

                                if (values.indexOf(value) > -1) {
                                    if( !$swatch.hasClass('blur-cross')) {
                                        $swatch.removeClass('disabled');
                                    }

                                    // Combo exists but is out of stock for the current
                                    // selection -> disable it the same way as a missing combo.
                                    if (!$swatch.hasClass('blur-cross') &&
                                        !matchingVariationInStock(attrName, value, chosen, variations)) {
                                        $swatch.addClass('disabled');

                                        if ($swatch.closest('.tawcvs-swatches').hasClass('oss-hide')) {
                                            $swatch.closest('.swatch-item-wrapper').hide();
                                        }

                                        if ($selected.length && value === $selected.val()) {
                                            $swatch.removeClass('selected');
                                        }
                                    }
                                } else {
                                    $swatch.addClass('disabled');

                                    if ($swatch.closest('.tawcvs-swatches').hasClass('oss-hide')) {
                                        $swatch.closest('.swatch-item-wrapper').hide();
                                    }

                                    if ($selected.length && value === $selected.val()) {
                                        $swatch.removeClass('selected');
                                    }
                                }
                            });
                        });
                    }, 50); // Faster response time
                })
                .on('tawcvs_no_matching_variations', function () {
                    window.alert(wc_add_to_cart_variation_params.i18n_no_matching_variations_text);
                });
        });
    };

    $.fn.change_variation_image_on_shop_page = function (variation) {
        var $product = $(this).closest('.product'),
            $product_img = $product.find('.woocommerce-LoopProduct-link img');

        if ($product_img.length !== 1) {
            return false;
        }

        if (variation && variation.image && variation.image.src && variation.image.src.length > 1) {
            $product_img.wc_set_variation_attr('src', variation.image.src);
            $product_img.wc_set_variation_attr('height', variation.image.src_h);
            $product_img.wc_set_variation_attr('width', variation.image.src_w);
            $product_img.wc_set_variation_attr('srcset', variation.image.srcset);
            $product_img.wc_set_variation_attr('sizes', variation.image.sizes);
            $product_img.wc_set_variation_attr('title', variation.image.title);
            $product_img.wc_set_variation_attr('data-caption', variation.image.caption);
            $product_img.wc_set_variation_attr('alt', variation.image.alt);
            $product_img.wc_set_variation_attr('data-src', variation.image.full_src);
            $product_img.wc_set_variation_attr('data-large_image', variation.image.full_src);
            $product_img.wc_set_variation_attr('data-large_image_width', variation.image.full_src_w);
            $product_img.wc_set_variation_attr('data-large_image_height', variation.image.full_src_h);
        } else {
            $product_img.wc_reset_variation_attr('src');
            $product_img.wc_reset_variation_attr('width');
            $product_img.wc_reset_variation_attr('height');
            $product_img.wc_reset_variation_attr('srcset');
            $product_img.wc_reset_variation_attr('sizes');
            $product_img.wc_reset_variation_attr('title');
            $product_img.wc_reset_variation_attr('data-caption');
            $product_img.wc_reset_variation_attr('alt');
            $product_img.wc_reset_variation_attr('data-src');
            $product_img.wc_reset_variation_attr('data-large_image');
            $product_img.wc_reset_variation_attr('data-large_image_width');
            $product_img.wc_reset_variation_attr('data-large_image_height');
        }
    }

    //Tracking the reset_variations button on change visibility -> change the corresponding display state
    function toggle_hidden_variation_btn() {
        const resetVariationNodes = document.getElementsByClassName('reset_variations');
        if (resetVariationNodes.length) {
            Array.prototype.forEach.call(resetVariationNodes, function (resetVariationEle) {
                let observer = new MutationObserver(function () {
                    if (resetVariationEle.style.visibility !== 'hidden') {
                        resetVariationEle.style.display = 'block';
                    } else {
                        resetVariationEle.style.display = 'none';
                    }
                });
                observer.observe(resetVariationEle, {attributes: true, childList: true});
            })
        }
    }

    // OPTIMIZED: Performance monitoring for large products
    function logPerformanceInfo() {
        if (typeof tawcvs_config !== 'undefined' && console && console.log) {
            const $forms = $('.variations_form');
            const $largeProductForms = $forms.filter(function() {
                const variationData = $(this).find('.tawcvs-available-product-variation').data('product_variations');
                return variationData && variationData.length > tawcvs_config.large_product_threshold;
            });

            if ($largeProductForms.length > 0) {
                console.log('TAWCVS: PHP-optimized handling for', $largeProductForms.length, 'large product(s)');

                $largeProductForms.each(function() {
                    const variationData = $(this).find('.tawcvs-available-product-variation').data('product_variations');
                    if (variationData) {
                        console.log('TAWCVS: Loaded', variationData.length, 'variations instantly for product');
                    }
                });
            }
        }
    }

    // OPTIMIZED: Efficient initialization
    function initializeSwatches() {
        $('.variations_form').tawcvs_variation_swatches_form().trigger('woocommerce_update_variation_values');
        $(document.body).trigger('tawcvs_initialized');
        toggle_hidden_variation_btn();
        logPerformanceInfo();
    }

    // OPTIMIZED: Throttled re-initialization for AJAX content
    let reinitTimeout;
    function throttledReinit() {
        clearTimeout(reinitTimeout);
        reinitTimeout = setTimeout(() => {
            var $variations_form = $('.variations_form:not(.swatches-support)');
            if ($variations_form.length > 0) {
                $variations_form.each(function () {
                    $(this).wc_variation_form();
                });
                $variations_form.tawcvs_variation_swatches_form();
            }
        }, 50); // Faster reinit
    }

    $(function () {
        // Initialize swatches immediately
        initializeSwatches();
    });

    $(document).ajaxComplete(function () {
        throttledReinit();
    });

    // Handle dynamic content updates
    $(document).on('updated_wc_div wc_fragments_refreshed', function() {
        throttledReinit();
    });

})(jQuery);