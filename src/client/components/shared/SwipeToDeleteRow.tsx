import { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import { useSwipeable } from "react-swipeable";

const DELETE_ZONE_WIDTH = 80;

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  /**
   * When true, suppresses both the swipe handlers and the delete-zone
   * rendering — the one place permission gating happens structurally rather
   * than via an icon component, since mobile swipe-to-delete has no visible
   * icon to individually disable.
   */
  disabled?: boolean;
}

export default function SwipeToDeleteRow({
  children,
  onDelete,
  isOpen = false,
  onOpen,
  onClose,
  disabled = false,
}: Props) {
  const [offset, setOffset] = useState(
    isOpen && !disabled ? -DELETE_ZONE_WIDTH : 0,
  );
  const [transitioning, setTransitioning] = useState(false);
  const swiping = useRef(false);

  useEffect(() => {
    if (!swiping.current) {
      setTransitioning(true);
      setOffset(isOpen && !disabled ? -DELETE_ZONE_WIDTH : 0);
    }
  }, [isOpen, disabled]);

  const swipeHandlers = useSwipeable(
    disabled
      ? {}
      : {
          onSwipeStart: () => {
            swiping.current = true;
            setTransitioning(false);
          },
          onSwiping: ({ deltaX }) => {
            const base = isOpen ? -DELETE_ZONE_WIDTH : 0;
            setOffset(Math.max(-DELETE_ZONE_WIDTH, Math.min(0, base + deltaX)));
          },
          onSwipedLeft: () => {
            swiping.current = false;
            setTransitioning(true);
            setOffset(-DELETE_ZONE_WIDTH);
            onOpen?.();
          },
          onSwipedRight: () => {
            swiping.current = false;
            setTransitioning(true);
            setOffset(0);
            onClose?.();
          },
          onSwiped: ({ dir }) => {
            if (dir !== "Left" && dir !== "Right") {
              swiping.current = false;
              setTransitioning(true);
              setOffset(isOpen ? -DELETE_ZONE_WIDTH : 0);
            }
          },
          onTouchEndOrOnMouseUp: () => {
            setTimeout(() => {
              if (swiping.current) {
                swiping.current = false;
                setTransitioning(true);
                setOffset(isOpen ? -DELETE_ZONE_WIDTH : 0);
              }
            }, 0);
          },
          trackTouch: true,
          trackMouse: false,
          delta: 10,
          preventScrollOnSwipe: true,
        },
  );

  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      {/* Delete zone revealed as the row slides left */}
      {!disabled && (
        <Box
          sx={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: DELETE_ZONE_WIDTH,
            bgcolor: "error.main",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconButton onClick={onDelete} sx={{ color: "white" }} size="small">
            <DeleteIcon />
          </IconButton>
        </Box>
      )}

      {/* Sliding row content */}
      <Box
        {...swipeHandlers}
        sx={{
          position: "relative",
          bgcolor: "background.paper",
          transform: `translateX(${offset}px)`,
          transition: transitioning ? "transform 0.2s ease" : "none",
          userSelect: "none",
        }}
      >
        {children}
        {/* Transparent overlay when open: tapping anywhere on the row closes it */}
        {isOpen && !disabled && (
          <Box
            sx={{ position: "absolute", inset: 0, zIndex: 1 }}
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
          />
        )}
      </Box>
    </Box>
  );
}
