/* @ds-bundle: {"format":3,"namespace":"CentralStudioDesignSystem_abafe5","components":[{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"Card","sourcePath":"components/containers/Card.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Tag","sourcePath":"components/feedback/Tag.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Avatar","sourcePath":"components/media/Avatar.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/buttons/Button.jsx":"8782ad84545c","components/containers/Card.jsx":"23cbb76779df","components/feedback/Badge.jsx":"15868c979722","components/feedback/Tag.jsx":"8cdc7a92bb4a","components/forms/Input.jsx":"dc875d17658e","components/forms/Switch.jsx":"0b48f8f603de","components/media/Avatar.jsx":"c76d332acc56","components/navigation/Tabs.jsx":"ad28ad2d5408"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CentralStudioDesignSystem_abafe5 = window.CentralStudioDesignSystem_abafe5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  className = '',
  style = {},
  ...props
}) {
  const baseStyle = {
    fontFamily: 'var(--font-display)',
    fontWeight: 'var(--fw-semibold)',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'var(--t-color), var(--t-transform)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    opacity: disabled ? 0.5 : 1,
    ...style
  };
  const variants = {
    primary: {
      backgroundColor: 'var(--color-gold-500)',
      color: 'var(--color-black)',
      boxShadow: 'var(--shadow-subtle)'
    },
    secondary: {
      backgroundColor: 'var(--color-purple-500)',
      color: 'var(--color-white)',
      boxShadow: 'var(--shadow-subtle)'
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--color-black)',
      border: '1px solid var(--color-gray-300)'
    }
  };
  const sizes = {
    sm: {
      padding: '8px 16px',
      fontSize: '14px',
      borderRadius: 'var(--radius-sm)'
    },
    md: {
      padding: '12px 24px',
      fontSize: '16px',
      borderRadius: 'var(--radius-md)'
    },
    lg: {
      padding: '16px 32px',
      fontSize: '18px',
      borderRadius: 'var(--radius-md)'
    }
  };
  const hoverStyle = disabled ? {} : {
    backgroundColor: variant === 'primary' ? 'var(--color-gold-600)' : variant === 'secondary' ? 'var(--color-purple-600)' : 'var(--color-gray-100)',
    transform: 'scale(1.02)',
    boxShadow: 'var(--shadow-medium)'
  };
  const activeStyle = disabled ? {} : {
    transform: 'scale(0.98)',
    boxShadow: 'var(--shadow-subtle)'
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    style: {
      ...baseStyle,
      ...variants[variant],
      ...sizes[size]
    },
    onMouseEnter: e => {
      if (!disabled) {
        Object.assign(e.target.style, hoverStyle);
      }
    },
    onMouseLeave: e => {
      if (!disabled) {
        Object.assign(e.target.style, {
          ...variants[variant],
          ...sizes[size]
        });
      }
    },
    onMouseDown: e => {
      if (!disabled) {
        Object.assign(e.target.style, activeStyle);
      }
    },
    onMouseUp: e => {
      if (!disabled) {
        Object.assign(e.target.style, hoverStyle);
      }
    },
    onClick: onClick,
    disabled: disabled,
    className: className
  }, props), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/containers/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  children,
  image,
  title,
  subtitle,
  onClick,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      backgroundColor: 'var(--color-white)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-subtle)',
      overflow: 'hidden',
      transition: 'var(--t-color), var(--t-transform)',
      cursor: onClick ? 'pointer' : 'default',
      ...style
    },
    onClick: onClick
  }, props), image && /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: title || '',
    style: {
      width: '100%',
      height: 'auto',
      display: 'block',
      backgroundColor: 'var(--color-gray-200)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px'
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '18px',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--color-black)',
      marginBottom: subtitle ? '4px' : '0'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '14px',
      color: 'var(--color-gray-600)',
      marginBottom: children ? '12px' : '0'
    }
  }, subtitle), children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/containers/Card.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Badge({
  children,
  variant = 'info',
  style = {},
  ...props
}) {
  const variants = {
    info: {
      backgroundColor: 'var(--color-blue-100)',
      color: 'var(--color-blue-900)'
    },
    success: {
      backgroundColor: 'var(--color-emerald-100)',
      color: 'var(--color-emerald-900)'
    },
    warning: {
      backgroundColor: 'var(--color-amber-100)',
      color: 'var(--color-amber-900)'
    },
    danger: {
      backgroundColor: 'var(--color-red-100)',
      color: 'var(--color-red-900)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-block',
      padding: '4px 12px',
      fontSize: '12px',
      fontWeight: 'var(--fw-semibold)',
      borderRadius: 'var(--radius-full)',
      ...variants[variant],
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tag({
  children,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-block',
      padding: '6px 12px',
      fontSize: '13px',
      fontWeight: 'var(--fw-medium)',
      backgroundColor: 'var(--color-gray-200)',
      color: 'var(--color-gray-900)',
      borderRadius: 'var(--radius-sm)',
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tag.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  type = 'text',
  placeholder = '',
  value = '',
  onChange,
  disabled = false,
  error = false,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    disabled: disabled,
    style: {
      width: '100%',
      padding: '12px 16px',
      fontSize: '16px',
      fontFamily: 'var(--font-body)',
      border: `2px solid ${error ? 'var(--color-red-500)' : 'var(--color-gray-300)'}`,
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'var(--color-white)',
      color: 'var(--color-black)',
      transition: 'var(--t-color)',
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'not-allowed' : 'text',
      ...style
    }
  }, props));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  checked = false,
  onChange,
  disabled = false,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: e => onChange?.(!checked),
    style: {
      position: 'relative',
      width: '48px',
      height: '28px',
      borderRadius: 'var(--radius-full)',
      border: 'none',
      backgroundColor: checked ? 'var(--color-emerald-500)' : 'var(--color-gray-300)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'var(--t-color)',
      padding: 0,
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '2px',
      left: checked ? '26px' : '2px',
      width: '24px',
      height: '24px',
      borderRadius: 'var(--radius-full)',
      backgroundColor: 'var(--color-white)',
      transition: 'var(--timing-duration-fast)'
    }
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/media/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Avatar({
  src,
  initials = '?',
  size = 'md',
  style = {},
  ...props
}) {
  const sizes = {
    sm: {
      width: '32px',
      height: '32px',
      fontSize: '12px'
    },
    md: {
      width: '48px',
      height: '48px',
      fontSize: '16px'
    },
    lg: {
      width: '64px',
      height: '64px',
      fontSize: '20px'
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      ...sizes[size],
      borderRadius: 'var(--radius-full)',
      backgroundColor: src ? 'transparent' : 'var(--color-purple-300)',
      backgroundImage: src ? `url(${src})` : 'none',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      color: src ? 'transparent' : 'var(--color-white)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'var(--fw-semibold)',
      ...style
    }
  }, props), !src && initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tabs({
  tabs = [],
  activeTab = 0,
  onTabChange,
  style = {},
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      borderBottom: '1px solid var(--color-gray-200)',
      gap: 0
    }
  }, tabs.map((tab, idx) => /*#__PURE__*/React.createElement("button", {
    key: idx,
    onClick: () => onTabChange?.(idx),
    style: {
      flex: 1,
      padding: '12px 16px',
      border: 'none',
      backgroundColor: 'transparent',
      color: activeTab === idx ? 'var(--color-gold-500)' : 'var(--color-gray-600)',
      borderBottom: activeTab === idx ? '2px solid var(--color-gold-500)' : 'none',
      fontWeight: activeTab === idx ? 'var(--fw-semibold)' : 'var(--fw-regular)',
      cursor: 'pointer',
      transition: 'var(--t-color)',
      fontSize: '16px'
    }
  }, tab.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 0'
    }
  }, tabs[activeTab]?.content));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
